// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// - `send_webhook_event`: POST a text (or JSON) to a Webhook Agent, which turns
//   it into a Huginn event: "Gladys says the alarm is on" feeds a Huginn
//   scenario (a digest, a Telegram message, a log).
// - `run_agent`: Huginn checks an agent now (a page, a feed, a digest) instead
//   of waiting for its schedule.
// - `get_last_event`: the last event of an agent, for the next actions (read
//   it out, send it by message, compare it).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async send_webhook_event(hub, { fields = {} }) {
    return hub.sendWebhook(fields.device, fields.text);
  },

  async run_agent(hub, { fields = {} }) {
    await hub.runAgent(fields.device);
    return {};
  },

  async get_last_event(hub, { fields = {} }) {
    return hub.lastEventOf(fields.device);
  },
};
