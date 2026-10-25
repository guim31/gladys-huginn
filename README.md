# Huginn for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
brings the agents of [Huginn](https://github.com/huginn/huginn), the
self-hosted system of agents that watch the web and act for you, into Gladys:
one device per agent, scenes that react when an agent creates an event or falls
in error, scene actions that send an event to a Webhook Agent or run an agent,
and a dashboard widget of the latest events. It signs in to Huginn with an
account over the local network. No cloud.

> Tested against a real Huginn (Docker image `ghcr.io/huginn/huginn`), not yet
> in a real Gladys: feedback welcome in the
> [issues](https://github.com/guim31/gladys-huginn/issues).

## Features

- **One device per agent**, proposed in the Discover tab (the user adds the
  ones to follow): **Working**, **Last event** (an excerpt), **Last event
  date**, **Events kept**, **Error message**. A **Huginn** device counts the
  agents, those in error, the disabled ones, the events of the last 24 hours
  and the failed jobs. Feature names in French by default (English, German and
  Spanish available).
- **Scene triggers**, for every agent, added to Gladys or not: _An agent
  creates an event_ (agent, excerpt, content in JSON, event number), _An agent
  falls in error_ (error message), _Huginn is unreachable_, _Huginn answers
  again_.
- **Scene actions**: _Send an event to Huginn_ (text or JSON posted to a
  Webhook Agent, Huginn's answer as outputs), _Run a Huginn agent_, _Last event
  of an agent_ (excerpt, content, date, error, a ready-made sentence).
- **Dashboard widget** "Huginn events": events of 24 h, agents in error, then
  the last event of each agent.
- A **Test the connection** button, a connection status naming the problem, a
  **transport badge** per device. Every text in English, French, German and
  Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- **Huginn**, reachable from the Gladys machine, and an account on it
  (username or email, password).

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-huginn` (or
   install **Huginn** from the catalog once it is listed).
2. In **Configuration**, enter the address of Huginn
   (`http://192.168.1.2:3000`…), the username and the password. Save, then
   click **Test the connection**.
3. Open the **Discover** tab and add the agents to follow.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

Huginn has no REST API and no API key. Its web pages answer JSON when asked,
behind the session of the interface: the integration signs in through the
sign-in form (CSRF token, session cookie) and reads, at every refresh (30 s to
5 min, 1 min by default):

- `GET /agents.json` (25 agents per page): name, last event, last error log,
  events kept, disabled;
- `GET /worker_status?since_id=…`: how many events were created since the last
  one seen, and the failed jobs; only when there are some,
  `GET /events.json` (newest first, 8 pages at most).

Then, only when needed: `GET /agents/<id>/events.json` (the last event of an
agent not seen yet) and `GET /agents/<id>/logs` (the error message, read from
the HTML of the logs). Writes, on the user's request only:
`POST /agents/<id>/run` (with the CSRF token) and the public endpoint of a
Webhook Agent, `POST /users/<user>/web_requests/<agent>/<secret>`, whose secret
is read from the agent (never logged nor published to Gladys).

A password refused once is not tried again until the configuration is saved or
"Test the connection" is clicked: Huginn (Devise) locks an account after 10
failed sign-ins. What was seen is kept in `/data/huginn-state.json`, so an event
created during a restart is announced once, and nothing twice.

## Checked on a real Huginn, and what was not

On 25/10/2026, against `ghcr.io/huginn/huginn` (built-in database) on a private
Docker network, with a Webhook Agent, a Manual Event Agent, a Website Agent in
error and a Scheduler Agent: sign-in, agents, worker status, events, last event,
logs, run (CSRF token, also stale), Webhook Agent (good and bad secret), wrong
password (one attempt only), expired session, unreachable host, closed port,
another service. The answers are the fixtures of `test/fixtures/huginn/`.

Not checked: a real Gladys (rendering of the widget, scene editor), Huginn
behind a reverse proxy with a sub-path, an instance with hundreds of agents.

## Limitations

- The JSON pages of the web interface are not a documented API: a future
  version of Huginn could change them.
- Only the agents of the account are seen; failed jobs count the whole
  instance.
- "Working" follows the error logs only, not the per-type rules of Huginn's
  "Working?" column.
- Beyond 200 new events between two refreshes, the extra ones are counted but
  neither announced nor excerpted; 20 events at most fire the trigger per
  refresh.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the SDK's fake Gladys and an in-memory Huginn
(`test/helpers/fakeHuginn.js`) answering in the shapes recorded on a real one.
See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Huginn](https://github.com/huginn/huginn), MIT License, by Andrew Cantino
  and the Huginn contributors. The cover uses the official Huginn logo
  (`media/huginn-logo.svg` of that repository).
- [Gladys Assistant](https://github.com/GladysAssistant/Gladys) and its
  integration SDK and template, by Pierre-Gilles Leymarie and contributors.

## Disclaimer

This project is not affiliated with, endorsed by or connected to the Huginn
project. Huginn is a project of its own authors.

## License

[Apache-2.0](LICENSE).
