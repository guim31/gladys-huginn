// -----------------------------------------------------------------------------
// A readable excerpt of an event payload. Huginn payloads are free JSON: a
// Website Agent extracts `title` and `url`, an RSS Agent `title`, `content`,
// `url`, a Webhook Agent whatever was posted. The excerpt takes the first
// "headline" field found (title, then message, text…), adds a second one when
// it differs, and falls back on compact JSON.
// -----------------------------------------------------------------------------

const HEADLINES = ['title', 'subject', 'message', 'text', 'name', 'summary', 'description'];
const DETAILS = ['message', 'text', 'body', 'content', 'description', 'summary', 'url'];

const plain = (value) =>
  typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';

/** Shorten to `max` characters, with an ellipsis. */
export const shorten = (value, max) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/**
 * @param {unknown} payload
 * @param {number} [max] characters
 * @returns {string} never empty for a non-empty payload
 */
export function excerpt(payload, max = 200) {
  if (payload === null || payload === undefined) {
    return '';
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return shorten(plain(payload) || JSON.stringify(payload), max);
  }
  const headlineKey = HEADLINES.find((key) => plain(payload[key]));
  if (headlineKey) {
    const headline = plain(payload[headlineKey]);
    const detailKey = DETAILS.find(
      (key) => key !== headlineKey && plain(payload[key]) && plain(payload[key]) !== headline,
    );
    const detail = detailKey ? plain(payload[detailKey]) : '';
    return shorten(detail ? `${headline} — ${detail}` : headline, max);
  }
  const json = JSON.stringify(payload);
  return json === '{}' ? '' : shorten(json, max);
}

/** The payload as compact JSON, for a scene variable. */
export function payloadText(payload, max = 1000) {
  return shorten(JSON.stringify(payload ?? {}), max);
}
