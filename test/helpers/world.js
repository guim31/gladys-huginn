// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, an in-memory Huginn, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs: the tests read Huginn with
// `world.hub.pollNow()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { agentIds, serverIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { FakeHuginn, HOOK_SECRET, PASSWORD, USERNAME, agent } from './fakeHuginn.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';
// Dates are formatted in the time zone Gladys gives the container (TZ).
process.env.TZ = 'UTC';

export const HUGINN_URL = 'http://192.0.2.10:3000';

// The agents of the fixtures (test/fixtures/huginn/agents.json).
export const AGENTS = { broken: 10, scheduler: 11, hook: 8, manual: 9, digest: 3 };

/** A manual clock, shared by the hub, the fake Huginn and the tests. */
export function createClock(start = Date.parse('2026-10-25T06:00:00Z')) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CONFIG = { url: HUGINN_URL, username: USERNAME, password: PASSWORD, language: 'en' };

/**
 * @param {object} [options]
 * @param {FakeHuginn} [options.huginn]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  huginn = new FakeHuginn({ now: clock.now }),
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-huginn-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: (url, options) => huginn.request(url, options),
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, huginn, app, hub: app.hub, clock, dataDir };
}

export const deviceId = (gladys, id) => agentIds(gladys, id).device;
export const featureId = (gladys, id, feature) => agentIds(gladys, id).feature(feature);
export const serverFeatureId = (gladys, feature) => serverIds(gladys).feature(feature);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeHuginn, HOOK_SECRET, PASSWORD, USERNAME, agent };
