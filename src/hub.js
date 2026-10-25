// -----------------------------------------------------------------------------
// The Huginn hub: the instance read on a timer of the container (the interval
// chosen in the configuration); the states of the added devices published
// when they change, the scene events fired on new events, on agents falling
// in error and when Huginn stops or starts answering, and the views the
// widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and "an agent
// created an event" must fire for every agent, added to Gladys or not.
//
// One reading: the agents (25 per page), then the worker status since the
// last event seen, which says in one request whether new events exist; only
// then the event pages. What was learnt is kept in /data (src/store.js): the
// highest event id seen, the last event and the last error of each agent, the
// events of the last 24 hours by hour — so an event created while the
// integration or Gladys restarted is still announced, once.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  agentIds,
  agentValues,
  buildAgentDevice,
  buildServerDevice,
  isServerId,
  parseAgentId,
  serverIds,
  serverValues,
} from './devices.js';
import { excerpt, payloadText } from './excerpt.js';
import { HuginnClient, HuginnError } from './huginn/client.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  SENTENCE_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'huginn-hub' });

export const WIDGET_KEY = 'latest_events';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  EVENT: 'agent_event',
  ERROR: 'agent_error',
  UNREACHABLE: 'huginn_unreachable',
  BACK: 'huginn_back',
});

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads Huginn again when the last read is older.
  freshMs: 15_000,
  // The window of the event counter.
  windowMs: 24 * 3600_000,
  // Failed reads in a row before "Huginn is unreachable" fires (a restart of
  // Huginn or a network blip of one cycle stays quiet).
  unreachableAfter: 2,
};

const HOUR = 3600_000;
const MAX_TRANSPORTS_PER_REQUEST = 100;
// Pages of new events read per cycle (25 each), at most: beyond, the events
// are counted (worker status) but neither announced nor excerpted.
const MAX_EVENT_PAGES = 8;
// "An agent created an event" fired per cycle, at most (the newest ones).
const MAX_EVENTS_PER_READ = 20;
// Agents asked for their last event, or their error message, per cycle.
const MAX_LOOKUPS_PER_READ = 5;

const signatureOf = (config) =>
  JSON.stringify([config.url, config.username, config.password, config.allowSelfSigned]);

export class HuginnHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/huginn/http.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.signature = null;
    this.client = null;
    /** @type {Map<number, object>} agents of the last read, by id */
    this.agents = new Map();
    this.failedJobs = 0;
    this.readAt = 0;
    this.error = null;
    this.failedReads = 0;
    this.unreachableSince = null;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = this.emptySaved();
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle: one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  emptySaved() {
    // maxId: highest event id seen (null: never read); last: agent id →
    // { id, at, excerpt, payload }; errors: agent id → { at, message };
    // inError: agent ids in error at the last read; hours: hour start → events.
    return { maxId: null, last: {}, errors: {}, inError: [], hours: {}, url: null };
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const object = (value) => (value && typeof value === 'object' ? value : {});
    this.saved = {
      maxId: Number.isInteger(saved.maxId) ? saved.maxId : null,
      last: object(saved.last),
      errors: object(saved.errors),
      inError: Array.isArray(saved.inError) ? saved.inError.filter(Number.isInteger) : [],
      hours: object(saved.hours),
      url: typeof saved.url === 'string' ? saved.url : null,
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config && this.config.language !== config.language;
    const previousUrl = this.config?.url;
    this.config = config;
    const ready = config.url && config.username && config.password;
    const signature = ready ? signatureOf(config) : null;
    if (signature !== this.signature) {
      this.signature = signature;
      this.client = ready
        ? new HuginnClient({
            url: config.url,
            username: config.username,
            password: config.password,
            insecure: config.allowSelfSigned,
            request: this.request,
          })
        : null;
      // New credentials on the same instance keep an outage under way: its
      // "answers again" must still come, and "unreachable" not twice.
      if (config.url !== previousUrl || this.client === null) {
        this.failedReads = 0;
        this.unreachableSince = null;
      }
      this.agents = new Map();
      this.failedJobs = 0;
      this.readAt = 0;
      this.error = null;
      this.polling = null;
      // Another instance: what was learnt about the previous one is worthless.
      if (config.url && this.saved.url && this.saved.url !== config.url) {
        this.saved = this.emptySaved();
      }
      if (config.url) {
        this.saved.url = config.url;
      }
    }
    if (languageChanged) {
      this.discovered = null; // feature names follow the language
      this.gladys.forgetPublishedStates?.(); // so do the texts
    }
    try {
      await this.pollNow({ publish: true });
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Huginn works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading Huginn ----------------------------------------------------------

  /** Read the instance now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the instance and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling || this.polling.client !== this.client) {
      const polling = { client: this.client };
      polling.promise = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling.promise;
  }

  async read(client) {
    let agents;
    let status;
    try {
      agents = await client.agents();
      status = await client.workerStatus(this.saved.maxId ?? 0);
    } catch (err) {
      if (!(err instanceof HuginnError)) {
        throw err;
      }
      return client === this.client ? this.applyFailure(err) : false;
    }
    if (client !== this.client) {
      return false; // reconfigured meanwhile
    }
    return this.applySuccess(client, agents, status);
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    this.failedReads += 1;
    if (wasError !== err.kind) {
      logger.warn(`Huginn: ${err.message}`);
    }
    if (this.failedReads >= this.timings.unreachableAfter && this.unreachableSince === null) {
      this.unreachableSince = this.now();
      await this.fire(TRIGGERS.UNREACHABLE, {
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
    }
    return wasError !== err.kind;
  }

  async applySuccess(client, list, status) {
    const now = this.now();
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error || this.readAt === 0) {
      logger.info(`Connected to Huginn, ${list.length} agent(s)`);
    }
    if (this.unreachableSince !== null) {
      const minutes = Math.round((now - this.unreachableSince) / 60_000);
      await this.fire(TRIGGERS.BACK, { downtime_minutes: minutes });
    }
    this.error = null;
    this.failedReads = 0;
    this.unreachableSince = null;
    this.readAt = now;
    this.failedJobs = status.failedJobs;

    const next = new Map(list.map((agent) => [agent.id, agent]));
    for (const agent of next.values()) {
      const before = this.agents.get(agent.id);
      if (
        !before ||
        before.name !== agent.name ||
        before.inError !== agent.inError ||
        before.lastEventAt !== agent.lastEventAt
      ) {
        widgetChanged = true;
      }
    }
    if ([...this.agents.keys()].some((id) => !next.has(id))) {
      widgetChanged = true;
    }
    this.agents = next;

    const first = this.saved.maxId === null;
    if (first) {
      await this.seed(client, status);
    } else if (status.newEvents > 0) {
      await this.readNewEvents(client, status);
      widgetChanged = true;
    }
    await this.lookupLastEvents(client);
    await this.updateErrors(client, { announce: !first });

    // A deleted agent is forgotten.
    for (const key of ['last', 'errors']) {
      for (const id of Object.keys(this.saved[key])) {
        if (!next.has(Number(id))) {
          delete this.saved[key][id];
        }
      }
    }
    for (const hour of Object.keys(this.saved.hours)) {
      if (Number(hour) + HOUR <= now - this.timings.windowMs) {
        delete this.saved.hours[hour];
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    const key = JSON.stringify(this.saved);
    if (key !== this.savedKey) {
      this.savedKey = key;
      this.store.save(this.saved);
    }
    await this.publishStates();
    return widgetChanged;
  }

  count(event) {
    const hour = Math.floor(event.createdAt / HOUR) * HOUR;
    this.saved.hours[hour] = (this.saved.hours[hour] ?? 0) + 1;
  }

  /** Keep an event as the last one of its agent when it is newer. */
  remember(event) {
    const saved = this.saved.last[event.agentId];
    if (saved && saved.id >= event.id) {
      return;
    }
    this.saved.last[event.agentId] = {
      id: event.id,
      at: event.createdAt,
      excerpt: excerpt(event.payload),
      payload: payloadText(event.payload),
    };
  }

  /** The first read: the events of the last 24 hours set what is known, no scene event for the past. */
  async seed(client, status) {
    let events = [];
    try {
      ({ events } = await client.eventsSince({
        notBefore: this.now() - this.timings.windowMs,
        maxPages: MAX_EVENT_PAGES,
      }));
    } catch (err) {
      logger.debug(`Events unreadable at the first read: ${err.message}`);
    }
    for (const event of events) {
      this.count(event);
      this.remember(event);
    }
    this.saved.maxId = Math.max(status.maxId, ...events.map((event) => event.id));
    this.saved.inError = [...this.agents.values()]
      .filter((agent) => agent.inError)
      .map((agent) => agent.id);
  }

  /** The events created since the last read: counted, remembered, announced. */
  async readNewEvents(client, status) {
    let result;
    try {
      result = await client.eventsSince({ sinceId: this.saved.maxId, maxPages: MAX_EVENT_PAGES });
    } catch (err) {
      // Read again at the next cycle: maxId did not move.
      logger.debug(`New events unreadable: ${err.message}`);
      return;
    }
    const { events, complete } = result;
    for (const event of events) {
      this.count(event);
      this.remember(event);
    }
    if (!complete && status.newEvents > events.length) {
      // Beyond the pages read: counted in the current hour, not announced.
      const hour = Math.floor(this.now() / HOUR) * HOUR;
      this.saved.hours[hour] = (this.saved.hours[hour] ?? 0) + status.newEvents - events.length;
    }
    this.saved.maxId = Math.max(this.saved.maxId, status.maxId, ...events.map((e) => e.id));

    const ordered = [...events].sort((a, b) => a.id - b.id);
    const announced = ordered.slice(-MAX_EVENTS_PER_READ);
    const skipped = status.newEvents - announced.length;
    if (skipped > 0) {
      logger.debug(`${skipped} older new event(s) not announced`);
    }
    for (const event of announced) {
      const agent = this.agents.get(event.agentId);
      await this.fire(TRIGGERS.EVENT, {
        device: agentIds(this.gladys, event.agentId).device,
        agent: agent?.name ?? `Agent ${event.agentId}`,
        excerpt: excerpt(event.payload, 500),
        payload: payloadText(event.payload),
        event_id: String(event.id),
      });
    }
  }

  /** Agents whose last event is not known (older than the first read, or beyond the pages read). */
  async lookupLastEvents(client) {
    const missing = [...this.agents.values()].filter((agent) => {
      const saved = this.saved.last[agent.id];
      return agent.lastEventAt !== null && (!saved || agent.lastEventAt > saved.at + 1000);
    });
    // The agents added to Gladys first.
    missing.sort(
      (a, b) =>
        Number(this.isCreated(agentIds(this.gladys, b.id).device)) -
        Number(this.isCreated(agentIds(this.gladys, a.id).device)),
    );
    for (const agent of missing.slice(0, MAX_LOOKUPS_PER_READ)) {
      try {
        const event = await client.lastEvent(agent.id);
        if (event) {
          this.remember(event);
          // Same second as last_event_at at most: no lookup again.
          this.saved.last[agent.id].at = Math.max(this.saved.last[agent.id].at, agent.lastEventAt);
        }
      } catch (err) {
        logger.debug(`Last event of agent ${agent.id} unreadable: ${err.message}`);
      }
    }
  }

  /** The error message of the agents in error, and "an agent is in error" for the new ones. */
  async updateErrors(client, { announce }) {
    const before = new Set(this.saved.inError);
    let lookups = 0;
    for (const agent of this.agents.values()) {
      if (!agent.inError) {
        continue;
      }
      const saved = this.saved.errors[agent.id];
      if (saved?.at !== agent.lastErrorAt && lookups < MAX_LOOKUPS_PER_READ) {
        lookups += 1;
        try {
          const message = await client.lastError(agent.id);
          this.saved.errors[agent.id] = { at: agent.lastErrorAt, message: message ?? '' };
        } catch (err) {
          logger.debug(`Logs of agent ${agent.id} unreadable: ${err.message}`);
        }
      }
      if (announce && !before.has(agent.id)) {
        const message = this.saved.errors[agent.id]?.message ?? '';
        logger.info(`${agent.name} is in error${message ? `: ${message}` : ''}`);
        await this.fire(TRIGGERS.ERROR, {
          device: agentIds(this.gladys, agent.id).device,
          agent: agent.name,
          error: message.slice(0, 500),
        });
      }
    }
    this.saved.inError = [...this.agents.values()]
      .filter((agent) => agent.inError)
      .map((agent) => agent.id);
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.problems.recover('events', 'Scene events accepted again');
    } catch (err) {
      this.problems.fail('events', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Views -------------------------------------------------------------------

  /** Events of the last 24 hours (by hour: the oldest hour counts whole). */
  events24h() {
    const since = this.now() - this.timings.windowMs;
    return Object.entries(this.saved.hours)
      .filter(([hour]) => Number(hour) + HOUR > since)
      .reduce((sum, [, count]) => sum + count, 0);
  }

  totals() {
    const agents = [...this.agents.values()];
    return {
      agents: agents.length,
      inError: agents.filter((agent) => agent.inError).length,
      disabled: agents.filter((agent) => agent.disabled).length,
      events24h: this.events24h(),
      failedJobs: this.failedJobs,
    };
  }

  /** What every view needs about an agent. */
  view(agent) {
    return {
      agent,
      last: this.saved.last[agent.id] ?? null,
      error: agent.inError ? this.saved.errors[agent.id]?.message || null : null,
    };
  }

  // --- Publishing to Gladys ----------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    const { language } = this.config;
    return [
      buildServerDevice(this.gladys, { language }),
      ...[...this.agents.values()].map((agent) =>
        buildAgentDevice(this.gladys, agent, { language }),
      ),
    ];
  }

  /** Publish the Discovery list when it changed (an agent added, renamed…). */
  async publishDevices({ force = false } = {}) {
    if (!this.client || this.readAt === 0 || this.error) {
      return; // nothing read: keep the list Gladys has
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Huginn, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /** The user added (or updated) a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0 || this.error) {
      return;
    }
    const language = this.config.language;
    const states = [];
    const add = (values) => {
      for (const { externalId, value } of values) {
        if (value === null) {
          continue;
        }
        states.push(
          typeof value === 'number'
            ? { device_feature_external_id: externalId, state: value }
            : { device_feature_external_id: externalId, text: value.text },
        );
      }
    };
    for (const agent of this.agents.values()) {
      if (this.isCreated(agentIds(this.gladys, agent.id).device)) {
        add(agentValues(this.gladys, this.view(agent), language));
      }
    }
    if (this.isCreated(serverIds(this.gladys).device)) {
      add(serverValues(this.gladys, this.totals()));
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable". */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
    const entries = [];
    const ids = [
      serverIds(this.gladys).device,
      ...[...this.agents.keys()].map((id) => agentIds(this.gladys, id).device),
    ];
    for (const externalId of ids) {
      if (this.isCreated(externalId) && this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.config.invalidUrl) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (!this.client) {
      return { connected: false, message: CONNECTION_TEXT.noInstance };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: this.readAt > 0 };
  }

  async publishConnectionStatus() {
    if (this.client && this.readAt === 0) {
      return; // not read yet
    }
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands (scene actions, widget, report) --------------------------------

  /** Throws the reason Huginn cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message ?? ACTION_TEXT.noInstance, this.config.language));
    }
  }

  /** An error of a command, in the language of the configuration. */
  commandError(err) {
    if (err instanceof HuginnError) {
      if (err.status === 404) {
        return new Error(pick(ACTION_TEXT.unknownAgent, this.config.language));
      }
      return new Error(pick(ERROR_TEXT[err.kind], this.config.language));
    }
    return err;
  }

  /** The agent of a device field, read again if unknown or stale. */
  async agentOf(externalId) {
    if (!this.client) {
      throw new Error(pick(ACTION_TEXT.noInstance, this.config.language));
    }
    const id = parseAgentId(this.gladys, externalId);
    if (id === null) {
      throw new Error(pick(ACTION_TEXT.unknownAgent, this.config.language));
    }
    // The secret, the verbs or the agent itself may have changed in Huginn.
    await this.refreshIfStale();
    this.assertReadable();
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(pick(ACTION_TEXT.unknownAgent, this.config.language));
    }
    return agent;
  }

  /**
   * "Send an event to a Webhook Agent": JSON sent as is, anything else as
   * { text }. Gladys gets Huginn's answer.
   */
  async sendWebhook(externalId, raw) {
    const language = this.config.language;
    const agent = await this.agentOf(externalId);
    if (!agent.webhook) {
      throw new Error(pick(ACTION_TEXT.notWebhook, language));
    }
    if (!agent.webhook.post) {
      throw new Error(pick(ACTION_TEXT.noPost, language));
    }
    const body = typeof raw === 'string' ? raw.trim() : '';
    let payload = { text: body };
    if (/^[[{]/.test(body)) {
      try {
        payload = JSON.parse(body);
      } catch {
        // Not JSON after all: sent as text.
      }
    }
    let answer;
    try {
      answer = await this.client.sendToWebhook(agent, payload);
    } catch (err) {
      throw this.commandError(err);
    }
    const success = answer.status >= 200 && answer.status < 300;
    const response = answer.body.trim().slice(0, 1000);
    logger.info(`Event sent to ${agent.name}: HTTP ${answer.status}`);
    if (!success) {
      const reason = response.slice(0, 100);
      throw new Error(
        `${pick(ACTION_TEXT.webhookRefused, language)} (HTTP ${answer.status}${reason ? `, ${reason}` : ''})`,
      );
    }
    return { success, status: answer.status, response };
  }

  /** "Run an agent": Huginn queues a check now. */
  async runAgent(externalId) {
    const agent = await this.agentOf(externalId);
    try {
      await this.client.run(agent.id);
    } catch (err) {
      throw this.commandError(err);
    }
    logger.info(`Run of ${agent.name} requested`);
  }

  /** "Read the last event of an agent", for the next actions. */
  async lastEventOf(externalId) {
    const language = this.config.language;
    const agent = await this.agentOf(externalId);
    await this.refreshIfStale();
    const { last, error } = this.view(this.agents.get(agent.id) ?? agent);
    const current = this.agents.get(agent.id) ?? agent;
    const text = SENTENCE_TEXT[language] ?? SENTENCE_TEXT.en;
    let sentence = last?.excerpt
      ? labelled(current.name, last.excerpt, language)
      : text.none(current.name);
    if (current.inError) {
      sentence = `${sentence} (${text.error}${error ? `: ${error}` : ''})`;
    }
    return {
      excerpt: last?.excerpt ?? '',
      payload: last?.payload ?? '',
      date: last?.at ? new Date(last.at).toISOString() : '',
      working: !current.inError,
      error: error ?? '',
      sentence: sentence.slice(0, 1000),
    };
  }

  /** "Test the connection": a new sign-in is allowed, read Huginn now, one line. */
  async testConnection() {
    this.client?.allowSignIn();
    await this.pollNow({ publish: true });
    const message = {};
    const status = this.connectionStatus();
    const totals = this.totals();
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const parts = [text.ok, text.agents(totals.agents)];
      if (totals.inError > 0) {
        parts.push(text.errors(totals.inError));
      }
      parts.push(text.events(totals.events24h));
      message[language] = labelled('Huginn', parts.join(', '), language);
    }
    return message;
  }

  /** The error of Huginn in words, null when it answers. */
  errorText(language) {
    return this.error ? pick(ERROR_TEXT[this.error.kind], language) : null;
  }

  /** The agents of a widget selection: the chosen devices, or every agent. */
  select(chosen) {
    const ids = [chosen ?? []].flat().filter((id) => typeof id === 'string' && id);
    if (ids.length === 0 || ids.some((id) => isServerId(this.gladys, id))) {
      return [...this.agents.values()];
    }
    const wanted = new Set(ids.map((id) => parseAgentId(this.gladys, id)).filter(Boolean));
    return [...this.agents.values()].filter((agent) => wanted.has(agent.id));
  }
}
