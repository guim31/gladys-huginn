// -----------------------------------------------------------------------------
// Huginn client. Huginn has no REST API: its web pages answer JSON when asked
// (`Accept: application/json`), behind the session of the web interface
// (Devise: sign-in form, cookie, CSRF token). Checked against a real Huginn
// (ghcr.io/huginn/huginn, test/fixtures/huginn/).
//
// What the integration reads, and why:
//   - GET /agents.json?page=N: the agents, 25 per page (name, schedule, last
//     check, last event, last error log, events kept, disabled, options);
//   - GET /worker_status?since_id=N: the events created since the last one
//     seen (count and highest id) and the failed jobs of the last 5 days —
//     one cheap request tells whether anything happened;
//   - GET /events.json?page=N: the new events, newest first, read only when
//     the worker status counts some;
//   - GET /agents/<id>/events.json: the last event of one agent, once;
//   - GET /agents/<id>/logs: the error message of an agent in error (an HTML
//     fragment, the only place it exists).
// And what it writes, on the user's request only:
//   - POST /agents/<id>/run (CSRF token): run an agent now;
//   - POST /users/<user>/web_requests/<agent>/<secret>: an event sent to a
//     Webhook Agent, the public endpoint Huginn gives it (no session).
//
// Devise locks an account after 10 failed sign-ins (by default): a password
// refused once is not tried again until the configuration changes or the user
// asks for it ("Test the connection"), see `refused`.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // username or password refused (or account locked)
  NOT_HUGINN: 'not_huginn', // something answers, not Huginn
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

export class HuginnError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status, reason }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'HuginnError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// Kaminari's default page size, the one Huginn uses for agents and events.
export const PAGE_SIZE = 25;
// 40 pages of agents: an instance with a thousand agents is still read whole.
const MAX_AGENT_PAGES = 40;

const time = (value) => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const positiveInt = (value) => (Number.isInteger(value) && value > 0 ? value : null);

/** Huginn's own "recent error logs" rule (WorkingHelpers): an error less than 2 minutes before the last event counts. */
export function isInError(agent) {
  if (agent.lastErrorAt === null) {
    return false;
  }
  return agent.lastEventAt === null || agent.lastErrorAt > agent.lastEventAt - 2 * 60_000;
}

/**
 * One agent of /agents.json, normalized. The options and the memory of the
 * agent are dropped (they hold its credentials), except what a Webhook Agent
 * needs to be called: its secret and accepted verbs. Huginn does not send the
 * agent type: a `secret` option is what a Webhook Agent has.
 */
export function normalizeAgent(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = positiveInt(source.id);
  if (id === null) {
    return null;
  }
  const options = source.options && typeof source.options === 'object' ? source.options : {};
  // A Liquid secret ({% credential %}) is compared interpolated by Huginn:
  // its raw text would be refused, so the agent is not offered as a webhook.
  const typed = text(options.secret);
  const secret = typed && !/\{[{%]/.test(typed) ? typed : null;
  const verbs = (text(options.verbs) ?? 'post')
    .split(',')
    .map((verb) => verb.trim().toLowerCase())
    .filter(Boolean);
  const agent = {
    id,
    userId: positiveInt(source.user_id),
    name: text(source.name) ?? `Agent ${id}`,
    schedule: text(source.schedule),
    eventsCount: Number.isInteger(source.events_count) ? Math.max(0, source.events_count) : 0,
    lastCheckAt: time(source.last_check_at),
    lastEventAt: time(source.last_event_at),
    lastErrorAt: time(source.last_error_log_at),
    disabled: source.disabled === true || source.deactivated === true,
    webhook: secret && source.user_id ? { secret, post: verbs.includes('post') } : null,
  };
  agent.inError = isInError(agent);
  return agent;
}

/** One event of /events.json, normalized. */
export function normalizeEvent(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = positiveInt(source.id);
  const agentId = positiveInt(source.agent_id);
  if (id === null || agentId === null) {
    return null;
  }
  return {
    id,
    agentId,
    payload: source.payload ?? {},
    createdAt: time(source.created_at) ?? 0,
  };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (value) =>
  value.replace(/&(amp|lt|gt|quot|#39|apos|nbsp|#\d+);/g, (match, name) =>
    name.startsWith('#') && name !== '#39'
      ? String.fromCodePoint(Number(name.slice(1)))
      : (ENTITIES[name] ?? match),
  );

/**
 * The newest error of the logs fragment of an agent (rows newest first): the
 * first line of the message, without the Ruby stack trace.
 */
export function parseLastError(html) {
  const match = /data-modal-title="Error" data-modal-content="([^"]*)"/.exec(html ?? '');
  if (!match) {
    return null;
  }
  const first = decode(match[1]).split('\n')[0].trim();
  return first || null;
}

const csrfOf = (html) => /<meta name="csrf-token" content="([^"]+)"/.exec(html ?? '')?.[1] ?? null;
const flashOf = (html) =>
  decode(/<div id="flash_alert">([^<]*)<\/div>/.exec(html ?? '')?.[1] ?? '').trim() || null;

export class HuginnClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} options.username login (username or email)
   * @param {string} options.password
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, username, password, insecure = false, request = httpRequest, timeoutMs }) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs ?? 15_000;
    /** @type {Map<string, string>} session cookies */
    this.cookies = new Map();
    this.csrf = null;
    // The sign-in was refused: no new attempt until `allowSignIn()`.
    this.refused = null;
    this.signingIn = null;
  }

  /** Accept a new sign-in attempt after a refusal ("Test the connection"). */
  allowSignIn() {
    this.refused = null;
  }

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  keepCookies(headers) {
    const raw = headers?.['set-cookie'];
    for (const line of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      const pair = line.split(';')[0];
      const at = pair.indexOf('=');
      if (at > 0) {
        this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
      }
    }
  }

  /** One HTTP exchange, network errors sorted by kind. */
  async send(url, { method = 'GET', headers = {}, body, session = true } = {}) {
    const allHeaders = { ...headers };
    if (session && this.cookies.size > 0) {
      allHeaders.cookie = this.cookieHeader();
    }
    let response;
    try {
      response = await this.request(url, {
        method,
        headers: allHeaders,
        body,
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new HuginnError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      throw new HuginnError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
    }
    if (session) {
      this.keepCookies(response.headers);
    }
    return response;
  }

  /** Sign in through the form of the web interface (shared by concurrent callers). */
  signIn() {
    if (this.refused) {
      return Promise.reject(this.refused);
    }
    this.signingIn ??= this.doSignIn().finally(() => {
      this.signingIn = null;
    });
    return this.signingIn;
  }

  async doSignIn() {
    this.cookies.clear();
    this.csrf = null;
    const page = await this.send(`${this.url}/users/sign_in`, { headers: { accept: 'text/html' } });
    if (page.status >= 300 && page.status < 400) {
      throw new HuginnError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${page.status})`, {
        status: page.status,
      });
    }
    const token = page.status === 200 ? csrfOf(page.body) : null;
    if (!token || !/name="user\[login\]"/.test(page.body)) {
      throw new HuginnError(
        ERROR_KINDS.NOT_HUGINN,
        `No Huginn sign-in page (HTTP ${page.status})`,
        { status: page.status },
      );
    }
    const form = new URLSearchParams({
      authenticity_token: token,
      'user[login]': this.username,
      'user[password]': this.password,
      'user[remember_me]': '0',
    }).toString();
    const answer = await this.send(`${this.url}/users/sign_in`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      body: form,
    });
    const location = answer.headers?.location ?? '';
    if (answer.status >= 300 && answer.status < 400 && !/\/users\/sign_in/.test(location)) {
      return; // signed in: Devise redirects to the home page
    }
    // Refused: the form again (200 or 422), with "Invalid login or password."
    // or "Your account is locked." Anything else (a 502 of a proxy while
    // Huginn restarts, a 500) is not a verdict on the password: tried again.
    const reason = flashOf(answer.body);
    if (!reason && !/name="user\[login\]"/.test(answer.body ?? '')) {
      throw new HuginnError(
        answer.status >= 500 ? ERROR_KINDS.UNREACHABLE : ERROR_KINDS.HTTP,
        `Sign-in answered HTTP ${answer.status}`,
        { status: answer.status },
      );
    }
    this.refused = new HuginnError(
      ERROR_KINDS.AUTH,
      `Sign-in refused (HTTP ${answer.status})${reason ? `: ${reason}` : ''}`,
      { status: answer.status, reason },
    );
    throw this.refused;
  }

  /**
   * A page of the interface, signed in (once more if the session expired).
   * @returns {Promise<{ status: number, body: string }>} a 2xx answer
   */
  async call(path, { method = 'GET', accept = 'application/json', headers = {}, body } = {}) {
    if (this.cookies.size === 0) {
      await this.signIn();
    }
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.send(`${this.url}${path}`, {
        method,
        headers: { accept, ...headers },
        body,
      });
      const { status } = response;
      const location = response.headers?.location ?? '';
      const signedOut = status === 401 || (status === 302 && /\/users\/sign_in/.test(location));
      if (signedOut && attempt === 0) {
        await this.signIn(); // the session expired, or Huginn restarted
        continue;
      }
      if (signedOut) {
        throw new HuginnError(ERROR_KINDS.AUTH, `Session refused (HTTP ${status})`, { status });
      }
      if (status >= 300 && status < 400) {
        throw new HuginnError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
      }
      if (status < 200 || status >= 300) {
        throw new HuginnError(
          status === 404 ? ERROR_KINDS.NOT_HUGINN : ERROR_KINDS.HTTP,
          `HTTP ${status} on ${path.split('?')[0].replace(/\d+/g, ':id')}`,
          { status },
        );
      }
      return response;
    }
  }

  async json(path) {
    const { body } = await this.call(path);
    try {
      return JSON.parse(body);
    } catch {
      throw new HuginnError(ERROR_KINDS.NOT_HUGINN, 'The answer is not Huginn JSON');
    }
  }

  /** Every agent of the account, newest first (the order of Huginn). */
  async agents() {
    const agents = [];
    for (let page = 1; page <= MAX_AGENT_PAGES; page += 1) {
      const list = await this.json(`/agents.json?page=${page}`);
      if (!Array.isArray(list)) {
        throw new HuginnError(ERROR_KINDS.NOT_HUGINN, 'The agent list is not an array');
      }
      agents.push(...list.map(normalizeAgent).filter(Boolean));
      if (list.length < PAGE_SIZE) {
        break;
      }
    }
    return agents;
  }

  /**
   * Events created since `sinceId` (count, highest id) and the jobs failed in
   * the last 5 days (every account: the queue is shared).
   */
  async workerStatus(sinceId = 0) {
    const query = sinceId > 0 ? `?since_id=${sinceId}` : '';
    const data = await this.json(`/worker_status${query}`);
    if (!data || typeof data !== 'object' || !Number.isInteger(data.event_count)) {
      throw new HuginnError(ERROR_KINDS.NOT_HUGINN, 'The worker status is not Huginn JSON');
    }
    const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
    return {
      newEvents: count(data.event_count),
      maxId: count(data.max_id),
      failedJobs: count(data.recent_failures),
      pendingJobs: count(data.pending),
    };
  }

  /**
   * The events newer than `sinceId` (newest first), `maxPages` pages at most;
   * also the ones older than `notBefore` stop the reading.
   * @returns {Promise<{ events: object[], complete: boolean }>}
   */
  async eventsSince({ sinceId = 0, notBefore = 0, maxPages = 8 } = {}) {
    const events = [];
    // Pages are offsets: an event created meanwhile shifts the next page.
    const seen = new Set();
    for (let page = 1; page <= maxPages; page += 1) {
      const list = await this.json(`/events.json?page=${page}`);
      if (!Array.isArray(list)) {
        throw new HuginnError(ERROR_KINDS.NOT_HUGINN, 'The event list is not an array');
      }
      const normalized = list.map(normalizeEvent).filter(Boolean);
      let older = false;
      for (const event of normalized) {
        if (seen.has(event.id)) {
          continue;
        }
        seen.add(event.id);
        if (event.id > sinceId && event.createdAt >= notBefore) {
          events.push(event);
        } else {
          older = true;
        }
      }
      if (older || list.length < PAGE_SIZE) {
        return { events, complete: true };
      }
    }
    return { events, complete: false };
  }

  /** The last event of an agent, null when it has none. */
  async lastEvent(agentId) {
    const list = await this.json(`/agents/${agentId}/events.json`);
    return Array.isArray(list) ? (list.map(normalizeEvent).find(Boolean) ?? null) : null;
  }

  /** The message of the newest error log of an agent. */
  async lastError(agentId) {
    const { body } = await this.call(`/agents/${agentId}/logs`, { accept: 'text/html' });
    return parseLastError(body);
  }

  /** A CSRF token of the session, for the writes. */
  async token({ fresh = false } = {}) {
    if (!this.csrf || fresh) {
      const { body } = await this.call('/about', { accept: 'text/html' });
      this.csrf = csrfOf(body);
      if (!this.csrf) {
        throw new HuginnError(ERROR_KINDS.NOT_HUGINN, 'No CSRF token in the Huginn pages');
      }
    }
    return this.csrf;
  }

  /** "Run": Huginn queues a check of the agent now. */
  async run(agentId) {
    for (let attempt = 0; ; attempt += 1) {
      const csrf = await this.token({ fresh: attempt > 0 });
      try {
        await this.call(`/agents/${agentId}/run`, {
          method: 'POST',
          headers: { 'x-csrf-token': csrf, 'content-type': 'application/json' },
          body: '{}',
        });
        return;
      } catch (err) {
        // 422: the token went stale (a new session); once more with a new one.
        if (err.status !== 422 || attempt > 0) {
          throw err;
        }
      }
    }
  }

  /**
   * POST a JSON body to a Webhook Agent: its public endpoint, without the
   * session. The secret is part of the path: never logged.
   * @returns {Promise<{ status: number, body: string }>} whatever Huginn answers
   */
  async sendToWebhook(agent, payload) {
    if (!agent.webhook || !agent.userId) {
      throw new HuginnError(ERROR_KINDS.HTTP, 'Not a Webhook Agent');
    }
    const path = `/users/${agent.userId}/web_requests/${agent.id}/${encodeURIComponent(agent.webhook.secret)}`;
    const response = await this.send(`${this.url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/plain' },
      body: JSON.stringify(payload),
      session: false,
    });
    return { status: response.status, body: response.body ?? '' };
  }
}
