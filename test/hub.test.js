// -----------------------------------------------------------------------------
// The hub, end to end: the SDK's fake Gladys on one side, an in-memory Huginn
// on the other (shapes of a real one), a manual clock. Devices, states, new
// events and errors with their scene events, persistence across restarts,
// sign-in and session, failures, scene actions, widget, logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { FEATURE_KEYS, serverIds } from '../src/devices.js';
import {
  AGENTS,
  CONFIG,
  FakeHuginn,
  HOOK_SECRET,
  agent,
  createClock,
  createDevices,
  createWorld,
  deviceId,
  featureId,
  serverFeatureId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const result = await createWorld(options);
  t.after(() => result.app.stop());
  return result;
}

const fired = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);
const lastState = (w, externalId) =>
  w.fake.states.filter((state) => state.device_feature_external_id === externalId).at(-1);

async function step(w, ms = 60_000) {
  w.clock.advance(ms);
  await w.hub.pollNow();
}

test('the instance and one device per agent in the Discovery tab, nothing polled by Gladys', async (t) => {
  const w = await world(t);
  const devices = w.fake.discoveredDevices;
  assert.equal(devices[0].external_id, serverIds(w.gladys).device);
  assert.equal(devices[0].name, 'Huginn');
  assert.deepEqual(
    devices.slice(1, 5).map((d) => [d.name, d.external_id]),
    [
      ['Broken page', deviceId(w.gladys, 10)],
      ['Nightly run', deviceId(w.gladys, 11)],
      ['Gladys inbox', deviceId(w.gladys, 8)],
      ['Manual alerts', deviceId(w.gladys, 9)],
    ],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
    assert.ok(!JSON.stringify(device).includes(HOOK_SECRET), 'no secret in a device');
  }
  assert.deepEqual(
    devices[3].features.map((f) => f.external_id),
    ['working', 'last_event', 'last_event_at', 'events', 'error_message'].map((key) =>
      featureId(w.gladys, AGENTS.hook, key),
    ),
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.states.length, 0, 'nothing sent for devices not added');
  assert.equal(w.fake.sceneEvents.length, 0, 'the first read announces nothing');
});

test('French feature names by default', async (t) => {
  const { language: _language, ...config } = CONFIG;
  const w = await world(t, { config });
  assert.equal(w.fake.discoveredDevices[1].features[0].name, 'Fonctionne');
});

test('adding a device publishes all its states at once', async (t) => {
  const w = await world(t);
  await createDevices(w, (d) =>
    [deviceId(w.gladys, AGENTS.manual), deviceId(w.gladys, AGENTS.broken)].includes(d.external_id),
  );
  const value = (id, key) => {
    const state = lastState(w, featureId(w.gladys, id, key));
    return state?.text ?? state?.state;
  };
  assert.equal(value(AGENTS.manual, FEATURE_KEYS.WORKING), 1);
  assert.equal(value(AGENTS.manual, FEATURE_KEYS.LAST_EVENT), 'Porte du garage — Restée ouverte');
  assert.equal(value(AGENTS.manual, FEATURE_KEYS.LAST_EVENT_AT), '10/25/26, 5:51 AM');
  assert.equal(value(AGENTS.manual, FEATURE_KEYS.EVENTS), 1);
  assert.equal(value(AGENTS.manual, FEATURE_KEYS.ERROR_MESSAGE), 'None');
  assert.equal(value(AGENTS.broken, FEATURE_KEYS.WORKING), 0, 'the agent in error');
  assert.equal(
    value(AGENTS.broken, FEATURE_KEYS.ERROR_MESSAGE),
    "Error when fetching url: Couldn't resolve host name",
    'the first line of its newest error log, from the real logs page',
  );
  assert.equal(value(AGENTS.broken, FEATURE_KEYS.LAST_EVENT), undefined, 'no event, no text');
  assert.equal(w.fake.widgetRefreshes.at(-1), WIDGET_KEY);
});

test('the instance device counts agents, errors, disabled agents, events of 24 h and failed jobs', async (t) => {
  const huginn = new FakeHuginn();
  huginn.agents[1].disabled = true;
  huginn.failedJobs = 3;
  const w = await world(t, { huginn, clock: createClock() });
  await createDevices(w, (d) => d.external_id === serverIds(w.gladys).device);
  const value = (key) => lastState(w, serverFeatureId(w.gladys, key))?.state;
  assert.equal(value(FEATURE_KEYS.AGENTS), 11);
  assert.equal(value(FEATURE_KEYS.AGENTS_ERROR), 1);
  assert.equal(value(FEATURE_KEYS.AGENTS_DISABLED), 1);
  assert.equal(value(FEATURE_KEYS.EVENTS_24H), 2);
  assert.equal(value(FEATURE_KEYS.FAILED_JOBS), 3);
  // A day later, the two events of the fixtures leave the window.
  await step(w, 25 * 3600_000);
  assert.equal(value(FEATURE_KEYS.EVENTS_24H), 0);
});

test('a new event fires "an agent creates an event" and updates the agent, once', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.huginn.emit(AGENTS.hook, { text: 'Coffee is ready', room: 'kitchen' });
  await step(w);
  assert.deepEqual(fired(w, TRIGGERS.EVENT), [
    {
      key: TRIGGERS.EVENT,
      data: {
        device: deviceId(w.gladys, AGENTS.hook),
        agent: 'Gladys inbox',
        excerpt: 'Coffee is ready',
        payload: '{"text":"Coffee is ready","room":"kitchen"}',
        event_id: '3',
      },
    },
  ]);
  assert.equal(
    lastState(w, featureId(w.gladys, AGENTS.hook, FEATURE_KEYS.LAST_EVENT)).text,
    'Coffee is ready',
  );
  assert.equal(lastState(w, serverFeatureId(w.gladys, FEATURE_KEYS.EVENTS_24H)).state, 3);
  await step(w);
  assert.equal(fired(w, TRIGGERS.EVENT).length, 1, 'not announced twice');
  assert.deepEqual(
    w.huginn.requests.slice(-2),
    ['GET /agents.json?page=1', 'GET /worker_status?since_id=3'],
    'a quiet cycle is two requests',
  );
});

test('an agent with no event read yet gets its last event looked up', async (t) => {
  const clock = createClock();
  const huginn = new FakeHuginn({ now: clock.now });
  // An event older than the 24 hours read at the first start.
  huginn.events.push({
    ...huginn.events[0],
    id: 100,
    agent_id: AGENTS.digest,
    payload: { title: 'Old digest' },
    created_at: '2026-10-01T08:00:00.000Z',
  });
  huginn.agents.find((a) => a.id === AGENTS.digest).last_event_at = '2026-10-01T08:00:00.000Z';
  const w = await world(t, { huginn, clock });
  assert.equal(w.hub.view(w.hub.agents.get(AGENTS.digest)).last.excerpt, 'Old digest');
  assert.ok(huginn.requests.includes(`GET /agents/${AGENTS.digest}/events.json`));
});

test('beyond 20 new events in one reading, the newest are announced and all are counted', async (t) => {
  const w = await world(t);
  await createDevices(w, (d) => d.external_id === serverIds(w.gladys).device);
  for (let index = 1; index <= 60; index += 1) {
    w.huginn.emit(AGENTS.manual, { title: `Item ${index}` });
  }
  await step(w);
  const events = fired(w, TRIGGERS.EVENT);
  assert.equal(events.length, 20);
  assert.equal(events[0].data.excerpt, 'Item 41');
  assert.equal(events.at(-1).data.excerpt, 'Item 60');
  assert.equal(lastState(w, serverFeatureId(w.gladys, FEATURE_KEYS.EVENTS_24H)).state, 62);
});

test('an agent falling in error fires "an agent falls in error" with its message, once', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.huginn.fail(AGENTS.hook, 'Boom &amp; bang');
  await step(w);
  assert.deepEqual(fired(w, TRIGGERS.ERROR), [
    {
      key: TRIGGERS.ERROR,
      data: {
        device: deviceId(w.gladys, AGENTS.hook),
        agent: 'Gladys inbox',
        error: 'Boom & bang',
      },
    },
  ]);
  assert.equal(lastState(w, featureId(w.gladys, AGENTS.hook, FEATURE_KEYS.WORKING)).state, 0);
  await step(w);
  assert.equal(fired(w, TRIGGERS.ERROR).length, 1);
  // A new event after the error: working again (Huginn's own rule).
  w.clock.advance(5 * 60_000);
  w.huginn.emit(AGENTS.hook, { text: 'ok' });
  await step(w);
  assert.equal(lastState(w, featureId(w.gladys, AGENTS.hook, FEATURE_KEYS.WORKING)).state, 1);
  assert.equal(
    lastState(w, featureId(w.gladys, AGENTS.hook, FEATURE_KEYS.ERROR_MESSAGE)).text,
    'None',
  );
  assert.ok(!fired(w, TRIGGERS.ERROR).some((event) => event.data.agent === 'Broken page'));
});

test('a restart neither repeats an event nor misses one created meanwhile', async (t) => {
  const clock = createClock();
  const huginn = new FakeHuginn({ now: clock.now });
  const first = await world(t, { huginn, clock });
  const dataDir = first.dataDir;
  huginn.emit(AGENTS.manual, { title: 'Before the restart' });
  await step(first);
  assert.equal(fired(first, TRIGGERS.EVENT).length, 1);
  await first.app.stop();

  huginn.emit(AGENTS.manual, { title: 'While stopped' });
  const second = await world(t, { huginn, clock, dataDir });
  assert.deepEqual(
    fired(second, TRIGGERS.EVENT).map((event) => event.data.excerpt),
    ['While stopped'],
  );
  assert.equal(second.hub.events24h(), 4);
});

test('another Huginn address forgets what was learnt', async (t) => {
  const w = await world(t);
  assert.equal(w.hub.saved.maxId, 2);
  await w.fake.configUpdated({ ...CONFIG, url: 'http://192.0.2.11:3000' });
  assert.equal(w.hub.saved.url, 'http://192.0.2.11:3000');
  assert.equal(fired(w, TRIGGERS.EVENT).length, 0, 'the new instance starts silent');
});

test('Huginn down: unreachable after two reads, the badge, then back with the outage length', async (t) => {
  const w = await world(t);
  await createDevices(w, (d) => d.external_id === deviceId(w.gladys, AGENTS.manual));
  w.huginn.failure = 'down';
  await step(w);
  assert.equal(fired(w, TRIGGERS.UNREACHABLE).length, 0, 'one failed read stays quiet');
  await step(w);
  assert.deepEqual(fired(w, TRIGGERS.UNREACHABLE)[0].data, { error: 'Huginn does not answer' });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: deviceId(w.gladys, AGENTS.manual),
    transport: 'unreachable',
  });
  await step(w);
  assert.equal(fired(w, TRIGGERS.UNREACHABLE).length, 1);
  w.huginn.failure = null;
  await step(w);
  assert.deepEqual(fired(w, TRIGGERS.BACK)[0].data, { downtime_minutes: 2 });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.transports.at(-1).transport, 'local');
});

test('a refused password is tried once, then not again until the configuration is saved', async (t) => {
  const w = await world(t, { config: { ...CONFIG, password: 'wrong' } });
  assert.equal(w.huginn.refusedSignIns, 1);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /sign-in refused/);
  await step(w);
  await step(w);
  assert.equal(w.huginn.refusedSignIns, 1, 'Devise locks the account after 10 failures');
  assert.equal(fired(w, TRIGGERS.UNREACHABLE).length, 0, 'Huginn answers: not an outage');
  const report = await w.fake.action('test_connection', {});
  assert.equal(w.huginn.refusedSignIns, 2, '"Test the connection" tries again');
  assert.match(report.data.message.en, /sign-in refused/);
  await w.fake.configUpdated({ ...CONFIG });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('an expired session signs in again, without losing a cycle', async (t) => {
  const w = await world(t);
  w.huginn.expireSession();
  w.huginn.emit(AGENTS.manual, { title: 'After expiry' });
  await step(w);
  assert.equal(w.huginn.signIns, 2);
  assert.equal(fired(w, TRIGGERS.EVENT).length, 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a deleted agent is forgotten, a new one is proposed', async (t) => {
  const w = await world(t);
  w.huginn.agents = w.huginn.agents.filter((a) => a.id !== AGENTS.manual);
  w.huginn.agents.unshift(agent({ id: 12, name: 'Price watch' }));
  await step(w);
  const names = w.fake.discoveredDevices.map((d) => d.name);
  assert.ok(names.includes('Price watch'));
  assert.ok(!names.includes('Manual alerts'));
  assert.equal(w.hub.saved.last[AGENTS.manual], undefined);
});

test('send an event to a Webhook Agent: JSON as is, text as { text }', async (t) => {
  const w = await world(t);
  const device = deviceId(w.gladys, AGENTS.hook);
  let ack = await w.fake.sceneAction('send_webhook_event', { device, text: 'Alarm is on' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { success: true, status: 201, response: 'Event Created' });
  ack = await w.fake.sceneAction('send_webhook_event', { device, text: '{"room":"salon"}' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    w.huginn.webhooks.map((hook) => hook.payload),
    [{ text: 'Alarm is on' }, { room: 'salon' }],
  );
});

test('send an event: clear errors for a non-webhook agent, a stale secret, no POST', async (t) => {
  const w = await world(t);
  let ack = await w.fake.sceneAction('send_webhook_event', {
    device: deviceId(w.gladys, AGENTS.manual),
    text: 'x',
  });
  assert.match(ack.error, /not a Webhook Agent/);
  w.huginn.agents.find((a) => a.id === AGENTS.hook).options.verbs = 'get';
  w.clock.advance(60_000);
  ack = await w.fake.sceneAction('send_webhook_event', {
    device: deviceId(w.gladys, AGENTS.hook),
    text: 'x',
  });
  assert.match(ack.error, /does not accept POST/);
  ack = await w.fake.sceneAction('send_webhook_event', { device: 'something-else', text: 'x' });
  assert.match(ack.error, /not a Huginn agent/);
  // The secret changed in Huginn since the last read.
  const hook = w.hub.agents.get(AGENTS.hook);
  hook.webhook = { secret: 'old', post: true };
  ack = await w.fake.sceneAction('send_webhook_event', {
    device: deviceId(w.gladys, AGENTS.hook),
    text: 'x',
  });
  assert.equal(ack.error, 'Huginn refused the event (HTTP 401, Not Authorized)');
});

test('run an agent: the CSRF token is taken once, renewed when stale', async (t) => {
  const w = await world(t);
  let ack = await w.fake.sceneAction('run_agent', { device: deviceId(w.gladys, AGENTS.broken) });
  assert.equal(ack.success, true, ack.error);
  w.hub.client.csrf = 'stale';
  ack = await w.fake.sceneAction('run_agent', { device: deviceId(w.gladys, AGENTS.scheduler) });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.huginn.runs, [AGENTS.broken, AGENTS.scheduler]);
  w.huginn.agents = w.huginn.agents.filter((a) => a.id !== AGENTS.scheduler);
  ack = await w.fake.sceneAction('run_agent', { device: deviceId(w.gladys, AGENTS.scheduler) });
  assert.match(ack.error, /no longer exists/, 'deleted in Huginn: 404');
});

test('last event of an agent, for the next actions', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'fr' } });
  let ack = await w.fake.sceneAction('get_last_event', {
    device: deviceId(w.gladys, AGENTS.manual),
  });
  assert.deepEqual(ack.data.outputs, {
    excerpt: 'Porte du garage — Restée ouverte',
    payload: '{"title":"Porte du garage","message":"Restée ouverte"}',
    date: '2026-10-25T05:51:06.000Z',
    working: true,
    error: '',
    sentence: 'Manual alerts : Porte du garage — Restée ouverte',
  });
  ack = await w.fake.sceneAction('get_last_event', { device: deviceId(w.gladys, AGENTS.broken) });
  assert.equal(
    ack.data.outputs.sentence,
    "Broken page n'a encore aucun événement. (en erreur : Error when fetching url: Couldn't resolve host name)".replace(
      ' : ',
      ': ',
    ),
  );
  assert.equal(ack.data.outputs.working, false);
});

test('the widget: tiles, agents in error first, then the newest events', async (t) => {
  const w = await world(t);
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.equal(ack.success, true, ack.error);
  const { content } = ack.data;
  assert.deepEqual(validateWidgetContent(content), []);
  const [events, errors, list] = content.components;
  assert.equal(events.value, 2);
  assert.equal(errors.value, 1);
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle, item.badge?.text]),
    [
      ['Broken page', "Error when fetching url: Couldn't resolve host name", 'Erreur'],
      ['Manual alerts', 'Porte du garage — Restée ouverte', undefined],
      ['Gladys inbox', 'Bonjour depuis Gladys', undefined],
    ],
  );
  const chosen = await w.fake.widgetGet(WIDGET_KEY, {
    settings: { agents: [deviceId(w.gladys, AGENTS.hook)] },
    language: 'en',
  });
  assert.deepEqual(
    chosen.data.content.components.map((component) => component.type),
    ['value', 'card-list'],
    'no 24-hour tile for a selection',
  );
});

test('the widget says what is missing, and when Huginn is down', async (t) => {
  const empty = await world(t, { config: { language: 'en' } });
  let ack = await empty.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'de' });
  assert.match(ack.data.content.components[0].text, /Gib die Adresse von Huginn/);
  assert.deepEqual(empty.fake.connectionStatus.connected, false);

  const w = await world(t);
  w.huginn.failure = 'down';
  await step(w);
  ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.equal(ack.data.content.components[0].text, 'Huginn does not answer');
  assert.equal(ack.data.content.ttl_seconds, 60);
});

test('"Test the connection" sums the instance up in four languages', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.deepEqual(ack.data.message, {
    en: 'Huginn: OK, 11 agent(s), 1 in error, 2 event(s) in 24 h',
    fr: 'Huginn : OK, 11 agent(s), 1 en erreur, 2 événement(s) sur 24 h',
    de: 'Huginn: OK, 11 Agent(en), 1 fehlerhaft, 2 Ereignis(se) in 24 h',
    es: 'Huginn: OK, 11 agente(s), 1 con error, 2 evento(s) en 24 h',
  });
});

test('a normal cycle writes nothing at info level, and never the password or the secret', async (t) => {
  const lines = [];
  const original = process.stdout.write.bind(process.stdout);
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  const w = await world(t);
  process.stdout.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    w.huginn.emit(AGENTS.manual, { title: 'Quiet' });
    await step(w);
    await step(w);
    await w.fake.sceneAction('send_webhook_event', {
      device: deviceId(w.gladys, AGENTS.hook),
      text: 'x',
    });
  } finally {
    process.stdout.write = original;
    process.env.LOG_LEVEL = level;
  }
  const all = lines.join('');
  assert.ok(!all.includes(CONFIG.password), 'no password');
  assert.ok(!all.includes(HOOK_SECRET), 'no webhook secret');
  const info = lines.filter((line) => /\bINFO\b|"level":"info"|\binfo\b/i.test(line));
  assert.deepEqual(
    info.map((line) => line.replace(/^.*?(Event sent)/, '$1').trim()),
    info.length ? ['Event sent to Gladys inbox: HTTP 201'] : [],
    'only the user action at info',
  );
});

test('Gladys refusing an announcement (restarting): the event is announced at the next cycle, counted once', async (t) => {
  const w = await world(t);
  const publish = w.gladys.publishSceneEvent.bind(w.gladys);
  w.gladys.publishSceneEvent = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  w.huginn.emit(AGENTS.manual, { title: 'During the restart' });
  w.huginn.fail(AGENTS.hook, 'Boom');
  await step(w);
  w.gladys.publishSceneEvent = publish;
  await step(w);
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.EVENT, TRIGGERS.ERROR],
  );
  assert.equal(w.hub.events24h(), 3);
  await step(w);
  assert.equal(w.fake.sceneEvents.length, 2);
});

test('a proxy error on the sign-in is not a refused password: tried again', async (t) => {
  const huginn = new FakeHuginn();
  const request = huginn.request.bind(huginn);
  let broken = true;
  huginn.request = async (url, options) =>
    broken && options.method === 'POST' && url.endsWith('/users/sign_in')
      ? { status: 502, headers: {}, body: '<html>Bad Gateway</html>' }
      : request(url, options);
  const w = await world(t, { huginn });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.hub.client.refused, null);
  broken = false;
  await step(w);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a refused password is not tried again after a restart, but saving the configuration tries again', async (t) => {
  const clock = createClock();
  const huginn = new FakeHuginn({ now: clock.now });
  const wrong = { ...CONFIG, password: 'wrong' };
  const first = await world(t, { huginn, clock, config: wrong });
  await first.app.stop();
  const second = await world(t, { huginn, clock, config: wrong, dataDir: first.dataDir });
  assert.equal(huginn.refusedSignIns, 1, 'no new attempt at the restart');
  assert.equal(second.fake.connectionStatus.connected, false);
  await second.fake.configUpdated(wrong);
  assert.equal(huginn.refusedSignIns, 2, 'saving, even unchanged, tries again');
  await second.fake.configUpdated(CONFIG);
  assert.deepEqual(second.fake.connectionStatus, { connected: true });
  assert.equal(second.hub.saved.refused, undefined);
});

test('an agent whose events expired is looked up once, not at every cycle', async (t) => {
  const huginn = new FakeHuginn();
  huginn.agents.find((a) => a.id === AGENTS.digest).last_event_at = '2026-10-01T08:00:00.000Z';
  const w = await world(t, { huginn });
  await step(w);
  await step(w);
  const lookups = huginn.requests.filter((r) => r === `GET /agents/${AGENTS.digest}/events.json`);
  assert.equal(lookups.length, 1);
});

test('a Webhook Agent with a Liquid secret is not offered as a webhook', async (t) => {
  const huginn = new FakeHuginn();
  huginn.agents.find((a) => a.id === AGENTS.hook).options.secret = '{% credential hook %}';
  const w = await world(t, { huginn });
  const ack = await w.fake.sceneAction('send_webhook_event', {
    device: deviceId(w.gladys, AGENTS.hook),
    text: 'x',
  });
  assert.match(ack.error, /not a Webhook Agent/);
});
