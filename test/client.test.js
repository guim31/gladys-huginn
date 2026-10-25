// -----------------------------------------------------------------------------
// The Huginn client and its helpers, on the answers of a real Huginn
// (test/fixtures/huginn/): agents, events, logs, sign-in pages, plus the
// address parsing and the excerpt of a payload.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ERROR_KINDS,
  HuginnClient,
  isInError,
  normalizeAgent,
  normalizeEvent,
  parseLastError,
} from '../src/huginn/client.js';
import { normalizeConfig, parseInstanceUrl } from '../src/config.js';
import { excerpt } from '../src/excerpt.js';
import { FakeHuginn, PASSWORD, USERNAME } from './helpers/fakeHuginn.js';

const fixture = async (name) =>
  readFile(new URL(`./fixtures/huginn/${name}`, import.meta.url), 'utf8');

test('agents of a real Huginn: dates, error, webhook, and no option kept', async () => {
  const agents = JSON.parse(await fixture('agents.json')).map(normalizeAgent);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const broken = byId.get(10);
  assert.equal(broken.name, 'Broken page');
  assert.equal(broken.lastErrorAt, Date.parse('2026-10-25T05:51:22Z'));
  assert.equal(broken.inError, true);
  assert.deepEqual(byId.get(8).webhook, { secret: 'test-secret-123', post: true });
  assert.equal(byId.get(9).webhook, null, 'a Manual Event Agent has no secret');
  assert.equal(byId.get(5).webhook, null, 'an api_key option is not a webhook');
  assert.ok(!('options' in broken) && !('memory' in broken), 'credentials are dropped');
  assert.equal(normalizeAgent({ name: 'no id' }), null);
});

test("Huginn's working rule: an error counts unless an event came 2 minutes after it", () => {
  const at = Date.parse('2026-10-25T06:00:00Z');
  assert.equal(isInError({ lastErrorAt: null, lastEventAt: at }), false);
  assert.equal(isInError({ lastErrorAt: at, lastEventAt: null }), true);
  assert.equal(isInError({ lastErrorAt: at, lastEventAt: at + 60_000 }), true);
  assert.equal(isInError({ lastErrorAt: at, lastEventAt: at + 3 * 60_000 }), false);
});

test('events of a real Huginn', async () => {
  const events = JSON.parse(await fixture('events.json')).map(normalizeEvent);
  assert.deepEqual(events[0], {
    id: 2,
    agentId: 9,
    payload: { title: 'Porte du garage', message: 'Restée ouverte' },
    createdAt: Date.parse('2026-10-25T05:51:06Z'),
  });
});

test('the newest error of the real logs page, first line only, entities decoded', async () => {
  assert.equal(
    parseLastError(await fixture('agent-10-logs.html')),
    "Error when fetching url: Couldn't resolve host name",
  );
  assert.equal(parseLastError('<table></table>'), null);
});

test('sign-in: the refusal of a real Huginn is an auth error with its reason, tried once', async () => {
  const huginn = new FakeHuginn();
  const client = new HuginnClient({
    url: 'http://huginn.test',
    username: USERNAME,
    password: 'wrong',
    request: (url, options) => huginn.request(url, options),
  });
  await assert.rejects(client.agents(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.equal(err.reason, 'Invalid login or password.');
    return true;
  });
  await assert.rejects(client.workerStatus(), { kind: ERROR_KINDS.AUTH });
  assert.equal(huginn.signIns, 1);
  client.allowSignIn();
  client.password = PASSWORD;
  assert.equal((await client.agents()).length, 11);
});

test('network errors and foreign services are sorted by kind', async () => {
  const make = (request) =>
    new HuginnClient({ url: 'http://huginn.test', username: 'a', password: 'b', request });
  const refused = Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
  await assert.rejects(make(() => Promise.reject(refused)).agents(), {
    kind: ERROR_KINDS.UNREACHABLE,
  });
  const selfSigned = Object.assign(new Error('x'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  await assert.rejects(make(() => Promise.reject(selfSigned)).agents(), { kind: ERROR_KINDS.TLS });
  const other = async () => ({ status: 200, headers: {}, body: '<html>Router</html>' });
  await assert.rejects(make(other).agents(), { kind: ERROR_KINDS.NOT_HUGINN });
  const redirect = async () => ({ status: 301, headers: { location: 'https://x/' }, body: '' });
  await assert.rejects(make(redirect).agents(), { kind: ERROR_KINDS.REDIRECT });
});

test('addresses: bare host, copied page, sub-path, credentials refused', () => {
  assert.equal(parseInstanceUrl('192.0.2.10:3000'), 'http://192.0.2.10:3000');
  assert.equal(
    parseInstanceUrl('https://huginn.example.com/agents/12/edit'),
    'https://huginn.example.com',
  );
  assert.equal(parseInstanceUrl('https://example.com/huginn/events'), 'https://example.com/huginn');
  assert.equal(parseInstanceUrl('http://user:pw@example.com'), null);
  assert.equal(parseInstanceUrl('ftp://example.com'), null);
  const config = normalizeConfig({ url: 'not a url ::', username: ' admin ', password: ' pw ' });
  assert.equal(config.invalidUrl, true);
  assert.equal(config.username, 'admin');
  assert.equal(config.password, ' pw ', 'a password is kept as typed');
  assert.equal(config.language, 'fr');
  assert.equal(config.pollIntervalMs, 60_000);
});

test('excerpt: headline and detail, HTML stripped, JSON otherwise', () => {
  assert.equal(excerpt({ title: 'Porte', message: 'Ouverte' }), 'Porte — Ouverte');
  assert.equal(excerpt({ title: 'A', url: 'https://x' }), 'A — https://x');
  assert.equal(
    excerpt({ content: '<p>Hello <b>you</b></p>' }),
    '{"content":"<p>Hello <b>you</b></p>"}',
  );
  assert.equal(excerpt({ text: '<p>Hello <b>you</b></p>' }), 'Hello you');
  assert.equal(excerpt({ temp: 21 }), '{"temp":21}');
  assert.equal(excerpt({}), '');
  assert.equal(excerpt({ title: 'x'.repeat(300) }).length, 200);
});
