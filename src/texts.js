// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// results and errors. Four languages, the four of the Gladys interface; German
// says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './huginn/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noInstance: {
    en: 'Enter the address of Huginn, your username and your password in the configuration.',
    fr: "Saisissez l'adresse de Huginn, votre identifiant et votre mot de passe dans la configuration.",
    de: 'Gib die Adresse von Huginn, deinen Benutzernamen und dein Passwort in der Konfiguration ein.',
    es: 'Introduzca la dirección de Huginn, su usuario y su contraseña en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:3000',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:3000',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:3000',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:3000',
  },
};

// One short explanation per error kind (src/huginn/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Huginn does not answer',
    fr: 'Huginn ne répond pas',
    de: 'Huginn antwortet nicht',
    es: 'Huginn no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'sign-in refused: check the username and password, then save',
    fr: "connexion refusée : vérifiez l'identifiant et le mot de passe, puis enregistrez",
    de: 'Anmeldung abgelehnt: Prüfe Benutzername und Passwort und speichere dann',
    es: 'inicio de sesión rechazado: compruebe el usuario y la contraseña y guarde',
  },
  [ERROR_KINDS.NOT_HUGINN]: {
    en: 'no Huginn at this address',
    fr: 'aucun Huginn à cette adresse',
    de: 'kein Huginn unter dieser Adresse',
    es: 'no hay ningún Huginn en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    agents: (count) => `${count} agent(s)`,
    errors: (count) => `${count} in error`,
    events: (count) => `${count} event(s) in 24 h`,
  },
  fr: {
    ok: 'OK',
    agents: (count) => `${count} agent(s)`,
    errors: (count) => `${count} en erreur`,
    events: (count) => `${count} événement(s) sur 24 h`,
  },
  de: {
    ok: 'OK',
    agents: (count) => `${count} Agent(en)`,
    errors: (count) => `${count} fehlerhaft`,
    events: (count) => `${count} Ereignis(se) in 24 h`,
  },
  es: {
    ok: 'OK',
    agents: (count) => `${count} agente(s)`,
    errors: (count) => `${count} con error`,
    events: (count) => `${count} evento(s) en 24 h`,
  },
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  noInstance: {
    en: 'Huginn is not configured.',
    fr: "Huginn n'est pas configuré.",
    de: 'Huginn ist nicht konfiguriert.',
    es: 'Huginn no está configurado.',
  },
  unknownAgent: {
    en: 'This device is not a Huginn agent, or the agent no longer exists.',
    fr: "Cet appareil n'est pas un agent Huginn, ou l'agent n'existe plus.",
    de: 'Dieses Gerät ist kein Huginn-Agent, oder der Agent existiert nicht mehr.',
    es: 'Este dispositivo no es un agente de Huginn, o el agente ya no existe.',
  },
  notWebhook: {
    en: 'This agent is not a Webhook Agent (it has no secret).',
    fr: "Cet agent n'est pas un Webhook Agent (il n'a pas de secret).",
    de: 'Dieser Agent ist kein Webhook Agent (er hat kein Secret).',
    es: 'Este agente no es un Webhook Agent (no tiene secreto).',
  },
  noPost: {
    en: 'This Webhook Agent does not accept POST: add "post" to its verbs.',
    fr: "Ce Webhook Agent n'accepte pas POST : ajoutez « post » à ses verbs.",
    de: 'Dieser Webhook Agent nimmt kein POST an: Füge „post“ zu seinen verbs hinzu.',
    es: 'Este Webhook Agent no acepta POST: añada «post» a sus verbs.',
  },
  webhookRefused: {
    en: 'Huginn refused the event',
    fr: "Huginn a refusé l'événement",
    de: 'Huginn hat das Ereignis abgelehnt',
    es: 'Huginn ha rechazado el evento',
  },
};

// "Read the last event" sentence.
export const SENTENCE_TEXT = {
  en: { none: (name) => `${name} has no event yet.`, error: 'in error' },
  fr: { none: (name) => `${name} n'a encore aucun événement.`, error: 'en erreur' },
  de: { none: (name) => `${name} hat noch kein Ereignis.`, error: 'fehlerhaft' },
  es: { none: (name) => `${name} todavía no tiene ningún evento.`, error: 'con error' },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
