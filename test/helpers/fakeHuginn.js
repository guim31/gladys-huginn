// -----------------------------------------------------------------------------
// An in-memory Huginn, answering the pages the integration reads the way a real
// Huginn does (the shapes of test/fixtures/huginn/, recorded on
// ghcr.io/huginn/huginn): sign-in form and session cookie, CSRF token, agents
// and events 25 per page, worker status, agent logs, run, Webhook Agent.
// `failure` simulates a server down; `expireSession()` a lost session.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  readFileSync(new URL(`../fixtures/huginn/${name}`, import.meta.url), 'utf8');

export const USERNAME = 'admin';
export const PASSWORD = 'password123';
export const HOOK_SECRET = 'test-secret-123';
export const SIGN_IN_HTML = fixture('sign-in.html');
export const REFUSED_HTML = fixture('sign-in-refused.html');
export const LOGS_HTML = fixture('agent-10-logs.html');
const PAGE_SIZE = 25;

/** The agents of the real instance the fixtures come from (raw /agents.json entries). */
export const realAgents = () => JSON.parse(fixture('agents.json'));
export const realEvents = () => JSON.parse(fixture('events.json'));

/** A raw agent, in the shape of /agents.json. */
export function agent({ id, name, options = {}, lastEventAt = null, lastErrorAt = null, ...rest }) {
  return {
    ...realAgents()[0],
    id,
    user_id: 1,
    name,
    options,
    schedule: null,
    events_count: 0,
    last_check_at: null,
    last_event_at: lastEventAt,
    last_error_log_at: lastErrorAt,
    disabled: false,
    deactivated: false,
    ...rest,
  };
}

const iso = (ms) => new Date(ms).toISOString();

export class FakeHuginn {
  constructor({ agents = realAgents(), events = realEvents(), now = () => Date.now() } = {}) {
    this.agents = agents;
    this.events = events;
    this.now = now;
    this.sessions = new Set();
    this.counter = 0;
    this.failure = null; // 'down' | 'tls'
    this.failedJobs = 0;
    this.signIns = 0;
    this.refusedSignIns = 0;
    this.runs = [];
    this.webhooks = [];
    this.requests = [];
    this.logs = new Map([[10, LOGS_HTML]]);
  }

  expireSession() {
    this.sessions.clear();
  }

  /** A new event of an agent, as Huginn creates it. */
  emit(agentId, payload) {
    const id = Math.max(0, ...this.events.map((event) => event.id)) + 1;
    const at = iso(this.now());
    this.events.unshift({
      id,
      user_id: 1,
      agent_id: agentId,
      lat: null,
      lng: null,
      payload,
      created_at: at,
      updated_at: at,
      expires_at: null,
    });
    const target = this.agents.find((entry) => entry.id === agentId);
    if (target) {
      target.last_event_at = at;
      target.events_count += 1;
    }
    return id;
  }

  /** An error log on an agent. */
  fail(agentId, message) {
    const target = this.agents.find((entry) => entry.id === agentId);
    target.last_error_log_at = iso(this.now());
    this.logs.set(
      agentId,
      `<table><tr><td>${message}</td><td><a class="btn btn-default show-log-details" data-modal-title="Error" data-modal-content="${message}&#10;/app/some/file.rb:1" href="#">Details</a></td></tr></table>`,
    );
  }

  session(headers) {
    const match = /_rails_session=([^;]+)/.exec(headers.cookie ?? '');
    return match && this.sessions.has(match[1]) ? match[1] : null;
  }

  newCookie() {
    this.counter += 1;
    return `_rails_session=s${this.counter}; path=/; HttpOnly; SameSite=Lax`;
  }

  async request(url, { method = 'GET', headers = {}, body } = {}) {
    const target = new URL(url);
    const path = target.pathname;
    this.requests.push(`${method} ${path}${target.search}`);
    if (this.failure === 'down') {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
    if (this.failure === 'tls') {
      throw Object.assign(new Error('self-signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    }
    const json = (status, data, extra = {}) => ({
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
      body: JSON.stringify(data),
    });
    const html = (status, text, extra = {}) => ({
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...extra },
      body: text,
    });

    // Public: the Webhook Agent endpoint.
    const hook = /^\/users\/(\d+)\/web_requests\/(\d+)\/([^/]+)$/.exec(path);
    if (hook) {
      const agentId = Number(hook[2]);
      const target = this.agents.find((entry) => entry.id === agentId);
      if (!target) {
        return html(404, 'agent not found');
      }
      if (!target.options?.secret) {
        return html(404, 'not implemented');
      }
      if (decodeURIComponent(hook[3]) !== target.options.secret) {
        return html(401, 'Not Authorized');
      }
      const payload = JSON.parse(body ?? '{}');
      this.webhooks.push({ agentId, payload });
      this.emit(agentId, payload);
      return html(201, 'Event Created');
    }

    if (path === '/users/sign_in' && method === 'GET') {
      return html(200, SIGN_IN_HTML, { 'set-cookie': [this.newCookie()] });
    }
    if (path === '/users/sign_in' && method === 'POST') {
      this.signIns += 1;
      const form = new URLSearchParams(body);
      if (form.get('user[login]') === USERNAME && form.get('user[password]') === PASSWORD) {
        const cookie = this.newCookie();
        this.sessions.add(cookie.split(';')[0].split('=')[1]);
        return html(302, '', { location: 'http://huginn.test/', 'set-cookie': [cookie] });
      }
      this.refusedSignIns += 1;
      return html(200, REFUSED_HTML);
    }

    if (!this.session(headers)) {
      return headers.accept?.includes('json')
        ? json(401, { error: 'You need to sign in or sign up before continuing.' })
        : html(302, '', { location: 'http://huginn.test/users/sign_in' });
    }
    const page = Number(target.searchParams.get('page') ?? 1);
    const paged = (list) => list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    if (path === '/about') {
      return html(200, '<meta name="csrf-token" content="token-ok" /><p>About</p>');
    }
    if (path === '/agents.json') {
      return json(200, paged(this.agents));
    }
    if (path === '/events.json') {
      return json(200, paged(this.events));
    }
    if (path === '/worker_status') {
      const since = Number(target.searchParams.get('since_id') ?? 0);
      const events = this.events.filter((event) => event.id > since);
      return json(200, {
        pending: 0,
        awaiting_retry: 0,
        recent_failures: this.failedJobs,
        event_count: events.length,
        max_id: events.length ? Math.max(...events.map((event) => event.id)) : 0,
        events_url: '/events',
        compute_time: 0.01,
      });
    }
    const one = /^\/agents\/(\d+)\/(events\.json|logs|run)$/.exec(path);
    const found = one && this.agents.find((entry) => entry.id === Number(one[1]));
    if (one && !found) {
      return json(404, { status: 404, error: 'Not Found' });
    }
    if (one?.[2] === 'events.json') {
      return json(200, paged(this.events.filter((event) => event.agent_id === found.id)));
    }
    if (one?.[2] === 'logs') {
      return html(200, this.logs.get(found.id) ?? '<table></table>');
    }
    if (one?.[2] === 'run' && method === 'POST') {
      if (headers['x-csrf-token'] !== 'token-ok') {
        return json(422, { status: 422, error: 'Unprocessable Content' });
      }
      this.runs.push(found.id);
      return { status: 200, headers: {}, body: '' };
    }
    return json(404, { status: 404, error: 'Not Found' });
  }
}
