// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds. Three requests
// per cycle when nothing happened (agents, worker status, a page of events).
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  poll_interval: '60',
  allow_self_signed: false,
  language: 'fr',
};

// Pages of the Huginn interface: a URL copied from the browser points at one
// of them, the application lives at the root.
const INTERFACE_PATH =
  /\/(agents|events|scenarios|users|jobs|services|user_credentials|worker_status|about)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:3000`), or a URL copied from the browser
 * (`https://huginn.example.com/agents/12`). HTTP by default. A path is kept
 * (behind a reverse proxy sub-path), the interface pages dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseInstanceUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const value = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const chosen = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(chosen) ? chosen : DEFAULT_CONFIG[key];
  };
  const typed = value('url');
  const url = typed ? parseInstanceUrl(typed) : null;
  return {
    url,
    invalidUrl: Boolean(typed) && url === null,
    username: value('username'),
    // A password may start or end with a space: kept as typed.
    password: typeof source.password === 'string' ? source.password : '',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    allowSelfSigned: source.allow_self_signed === true || source.allow_self_signed === 'true',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
