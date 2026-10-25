// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab: the user adds the ones to
// follow, nothing is created on their behalf.
//
// - One device per agent, keyed on the agent id (the id Huginn uses in its
//   URLs and webhooks; permanent for the life of the agent):
//     - working: input/binary, 1 while the agent has no recent error (green
//       in Gladys), the "Working?" column of Huginn minus its per-type rules;
//     - last event: text/text, an excerpt of its payload;
//     - last event date: text/text, local date and time;
//     - events: counter-sensor/integer, the events Huginn keeps for it;
//     - error message: text/text, the newest error log ("None" else).
// - One "Huginn" device for the instance: agents, agents in error, disabled
//   agents, events of the last 24 hours, failed jobs (5 days).
//
// Published with should_poll: false: the integration reads Huginn on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const DEVICE_TYPES = Object.freeze({ AGENT: 'agent', SERVER: 'server' });
export const SERVER_ID = 'server';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  WORKING: 'working',
  LAST_EVENT: 'last_event',
  LAST_EVENT_AT: 'last_event_at',
  EVENTS: 'events',
  ERROR_MESSAGE: 'error_message',
  AGENTS: 'agents',
  AGENTS_ERROR: 'agents_error',
  AGENTS_DISABLED: 'agents_disabled',
  EVENTS_24H: 'events_24h',
  FAILED_JOBS: 'failed_jobs',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.WORKING]: 'Working',
    [FEATURE_KEYS.LAST_EVENT]: 'Last event',
    [FEATURE_KEYS.LAST_EVENT_AT]: 'Last event date',
    [FEATURE_KEYS.EVENTS]: 'Events kept',
    [FEATURE_KEYS.ERROR_MESSAGE]: 'Error message',
    [FEATURE_KEYS.AGENTS]: 'Agents',
    [FEATURE_KEYS.AGENTS_ERROR]: 'Agents in error',
    [FEATURE_KEYS.AGENTS_DISABLED]: 'Disabled agents',
    [FEATURE_KEYS.EVENTS_24H]: 'Events in 24 h',
    [FEATURE_KEYS.FAILED_JOBS]: 'Failed jobs (5 days)',
  },
  fr: {
    [FEATURE_KEYS.WORKING]: 'Fonctionne',
    [FEATURE_KEYS.LAST_EVENT]: 'Dernier événement',
    [FEATURE_KEYS.LAST_EVENT_AT]: 'Date du dernier événement',
    [FEATURE_KEYS.EVENTS]: 'Événements conservés',
    [FEATURE_KEYS.ERROR_MESSAGE]: "Message d'erreur",
    [FEATURE_KEYS.AGENTS]: 'Agents',
    [FEATURE_KEYS.AGENTS_ERROR]: 'Agents en erreur',
    [FEATURE_KEYS.AGENTS_DISABLED]: 'Agents désactivés',
    [FEATURE_KEYS.EVENTS_24H]: 'Événements sur 24 h',
    [FEATURE_KEYS.FAILED_JOBS]: 'Jobs en échec (5 jours)',
  },
  de: {
    [FEATURE_KEYS.WORKING]: 'Funktioniert',
    [FEATURE_KEYS.LAST_EVENT]: 'Letztes Ereignis',
    [FEATURE_KEYS.LAST_EVENT_AT]: 'Datum des letzten Ereignisses',
    [FEATURE_KEYS.EVENTS]: 'Gespeicherte Ereignisse',
    [FEATURE_KEYS.ERROR_MESSAGE]: 'Fehlermeldung',
    [FEATURE_KEYS.AGENTS]: 'Agenten',
    [FEATURE_KEYS.AGENTS_ERROR]: 'Fehlerhafte Agenten',
    [FEATURE_KEYS.AGENTS_DISABLED]: 'Deaktivierte Agenten',
    [FEATURE_KEYS.EVENTS_24H]: 'Ereignisse in 24 h',
    [FEATURE_KEYS.FAILED_JOBS]: 'Fehlgeschlagene Jobs (5 Tage)',
  },
  es: {
    [FEATURE_KEYS.WORKING]: 'Funciona',
    [FEATURE_KEYS.LAST_EVENT]: 'Último evento',
    [FEATURE_KEYS.LAST_EVENT_AT]: 'Fecha del último evento',
    [FEATURE_KEYS.EVENTS]: 'Eventos guardados',
    [FEATURE_KEYS.ERROR_MESSAGE]: 'Mensaje de error',
    [FEATURE_KEYS.AGENTS]: 'Agentes',
    [FEATURE_KEYS.AGENTS_ERROR]: 'Agentes con error',
    [FEATURE_KEYS.AGENTS_DISABLED]: 'Agentes desactivados',
    [FEATURE_KEYS.EVENTS_24H]: 'Eventos en 24 h',
    [FEATURE_KEYS.FAILED_JOBS]: 'Jobs fallidos (5 días)',
  },
};

// The text of "Error message" while the agent has none (a text state is never empty).
export const NO_ERROR = { en: 'None', fr: 'Aucune', de: 'Keiner', es: 'Ninguno' };

export const MODEL = 'Huginn agent';
export const SERVER_NAME = 'Huginn';
export const SERVER_MODEL = 'Huginn';

// Display bounds (the core never applies them on write).
export const MAX_COUNT = 1_000_000;
// A text state, at most (Gladys stores it in a string column).
export const MAX_TEXT = 200;

export const agentIds = (gladys, id) => gladys.externalIds(DEVICE_TYPES.AGENT, String(id));
export const serverIds = (gladys) => gladys.externalIds(DEVICE_TYPES.SERVER, SERVER_ID);

/** The id of an agent device external id, null when it is not one. */
export function parseAgentId(gladys, externalId) {
  const prefix = agentIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^[1-9]\d{0,15}$/.test(id) ? Number(id) : null;
}

export const isServerId = (gladys, externalId) => externalId === serverIds(gladys).device;

const sensor = (names, ids, key, extra) => ({
  name: names[key],
  external_id: ids.feature(key),
  read_only: true,
  has_feedback: false,
  ...extra,
});

const textFeature = (names, ids, key) =>
  sensor(names, ids, key, {
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    keep_history: false,
    // min and max are NOT NULL in Gladys, text features included.
    min: 0,
    max: 0,
  });

const counter = (names, ids, key) =>
  sensor(names, ids, key, {
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    keep_history: true,
    min: 0,
    max: MAX_COUNT,
  });

/** The discovery payload of an agent. */
export function buildAgentDevice(gladys, agent, { language = 'en' } = {}) {
  const ids = agentIds(gladys, agent.id);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: agent.name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    features: [
      sensor(names, ids, FEATURE_KEYS.WORKING, {
        category: DEVICE_FEATURE_CATEGORIES.INPUT,
        type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        keep_history: true,
        min: 0,
        max: 1,
      }),
      textFeature(names, ids, FEATURE_KEYS.LAST_EVENT),
      textFeature(names, ids, FEATURE_KEYS.LAST_EVENT_AT),
      counter(names, ids, FEATURE_KEYS.EVENTS),
      textFeature(names, ids, FEATURE_KEYS.ERROR_MESSAGE),
    ],
  };
}

/** The discovery payload of the instance device. */
export function buildServerDevice(gladys, { language = 'en' } = {}) {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: SERVER_NAME,
    external_id: ids.device,
    model: SERVER_MODEL,
    should_poll: false,
    features: [
      counter(names, ids, FEATURE_KEYS.AGENTS),
      counter(names, ids, FEATURE_KEYS.AGENTS_ERROR),
      counter(names, ids, FEATURE_KEYS.AGENTS_DISABLED),
      counter(names, ids, FEATURE_KEYS.EVENTS_24H),
      counter(names, ids, FEATURE_KEYS.FAILED_JOBS),
    ],
  };
}

/**
 * The local date and time of an event, in the language of the configuration
 * (Gladys gives the container its time zone in TZ).
 */
export function formatDate(ms, language) {
  return new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(ms),
  );
}

export const clip = (value, max = MAX_TEXT) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * The value of every feature of an agent (null: nothing to publish).
 * @param {object} agent see src/huginn/client.js
 * @param {{ excerpt: string, at: number }|null} last its last event
 * @param {string|null} error the message of its newest error log
 */
export function agentValues(gladys, { agent, last, error }, language) {
  const ids = agentIds(gladys, agent.id);
  const lastAt = last?.at ?? agent.lastEventAt;
  return [
    { key: FEATURE_KEYS.WORKING, value: agent.inError ? 0 : 1 },
    { key: FEATURE_KEYS.LAST_EVENT, value: last?.excerpt ? { text: clip(last.excerpt) } : null },
    {
      key: FEATURE_KEYS.LAST_EVENT_AT,
      value: lastAt ? { text: formatDate(lastAt, language) } : null,
    },
    { key: FEATURE_KEYS.EVENTS, value: agent.eventsCount },
    {
      key: FEATURE_KEYS.ERROR_MESSAGE,
      value: {
        text: clip((agent.inError && error) || (NO_ERROR[language] ?? NO_ERROR.en)),
      },
    },
  ].map((entry) => ({ ...entry, externalId: ids.feature(entry.key) }));
}

/** The values of the instance device. */
export function serverValues(gladys, totals) {
  const ids = serverIds(gladys);
  return [
    { key: FEATURE_KEYS.AGENTS, value: totals.agents },
    { key: FEATURE_KEYS.AGENTS_ERROR, value: totals.inError },
    { key: FEATURE_KEYS.AGENTS_DISABLED, value: totals.disabled },
    { key: FEATURE_KEYS.EVENTS_24H, value: totals.events24h },
    { key: FEATURE_KEYS.FAILED_JOBS, value: totals.failedJobs },
  ].map((entry) => ({ ...entry, externalId: ids.feature(entry.key) }));
}
