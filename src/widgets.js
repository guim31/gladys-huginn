// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `latest_events`.
//
// The use case: a glance at the wall tablet tells what Huginn found lately
// (a price, a news item, an alert) and whether an agent broke. So the widget
// shows the events of the last 24 hours and the agents in error, then one row
// per agent, newest event first: agent name, excerpt of its last event, date,
// an "Error" badge; a tap opens the detail (excerpt, error message). The
// agents in error come first: a broken agent is what needs a look.
//
// Every agent by default, or the ones chosen in the widget settings (devices
// added to Gladys). The figures are sent as values, not bound to device
// features: the widget works before any device is added.
//
// Budget (8 components, 2 texts): two tiles, one text when Huginn does not
// answer, one card-list of 8 rows at most. No button: running an agent or
// sending an event is a scene action.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { shorten } from './excerpt.js';
import { pick } from './texts.js';

export const MAX_ROWS = 8;

export const TEXT = {
  pick: {
    en: 'Enter the address of Huginn, your username and your password in the configuration of the integration.',
    fr: "Saisissez l'adresse de Huginn, votre identifiant et votre mot de passe dans la configuration de l'intégration.",
    de: 'Gib die Adresse von Huginn, deinen Benutzernamen und dein Passwort in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de Huginn, su usuario y su contraseña en la configuración de la integración.',
  },
  empty: {
    en: 'No event yet.',
    fr: 'Aucun événement pour le moment.',
    de: 'Noch kein Ereignis.',
    es: 'Todavía no hay ningún evento.',
  },
  events: {
    en: 'Events (24 h)',
    fr: 'Événements (24 h)',
    de: 'Ereignisse (24 h)',
    es: 'Eventos (24 h)',
  },
  errors: { en: 'In error', fr: 'En erreur', de: 'Fehlerhaft', es: 'Con error' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  noEvent: { en: 'No event', fr: 'Aucun événement', de: 'Kein Ereignis', es: 'Ningún evento' },
};

const t = (text, language) => pick(text, language);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** One card per agent with an event or an error: errors first, then newest event first. */
export function cards(hub, agents, language) {
  return agents
    .map((agent) => hub.view(agent))
    .filter((view) => view.last || view.agent.inError)
    .sort(
      (a, b) =>
        Number(b.agent.inError) - Number(a.agent.inError) ||
        (b.last?.at ?? 0) - (a.last?.at ?? 0) ||
        (b.last?.id ?? 0) - (a.last?.id ?? 0),
    )
    .slice(0, MAX_ROWS)
    .map(({ agent, last, error }) => {
      const item = { title: shorten(agent.name, 60) };
      const summary = (agent.inError && error) || last?.excerpt || t(TEXT.noEvent, language);
      item.subtitle = shorten(summary, 60);
      if (last?.at) {
        item.date = new Date(last.at).toISOString();
      }
      if (agent.inError) {
        item.badge = { text: t(TEXT.error, language), color: WIDGET_COLORS.DANGER };
      }
      const description = [error, last?.excerpt].filter(Boolean).join('\n\n');
      if (description) {
        item.description = shorten(description, 2000);
      }
      return item;
    });
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.pick, language);
  }
  const agents = hub.select(settings?.agents);
  const components = [];
  if (hub.readAt > 0 && !hub.error) {
    const all = [settings?.agents ?? []].flat().length === 0;
    const errors = agents.filter((agent) => agent.inError).length;
    // The 24-hour count exists for the whole instance only.
    if (all) {
      components.push({
        type: 'value',
        value: hub.events24h(),
        label: t(TEXT.events, language),
        icon: 'activity',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({
      type: 'value',
      value: errors,
      label: t(TEXT.errors, language),
      icon: 'alert-triangle',
      color: errors > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    });
  }
  const errorText = hub.errorText(language);
  if (errorText) {
    components.push({ type: 'text', variant: 'body', text: errorText });
  }
  const items = cards(hub, agents, language);
  if (items.length > 0) {
    components.push({ type: 'card-list', display: 'list', items });
  } else if (!errorText) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.empty, language) });
  }
  return { ttl_seconds: errorText ? 60 : 300, components };
}

async function action(_hub, { actionKey }) {
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
