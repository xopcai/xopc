import { expect, it } from 'vitest';

import { fixtureLifetimeSeconds, remoteEnduranceOptions, soakCoverage } from '../electron-remote-endurance.mjs';

it('keeps endurance opt-in and does not change the original chat runner defaults', () => {
  expect(remoteEnduranceOptions([])).toEqual({ connectionCycles: 0, connectionIntervalMs: 5000, soakSeconds: 0, sampleIntervalMs: 60000 });
});
it.each([
  ['--connection-cycles'], ['--connection-cycles', 'NaN'], ['--soak-seconds', '-1'],
  ['--connection-cycles', '100', '--connection-interval-ms', '1000'],
  ['--soak-seconds', '86400', '--soak-interval-ms', '1000'],
])('rejects incomplete or misleading full acceptance configuration %j', args => {
  expect(() => remoteEnduranceOptions(args)).toThrow();
});
it('allows explicitly short harness smoke while preserving the complete run requirements', () => {
  expect(remoteEnduranceOptions(['--connection-cycles', '3', '--connection-interval-ms', '1000', '--soak-seconds', '10', '--soak-interval-ms', '5000'])).toMatchObject({ connectionCycles: 3, soakSeconds: 10 });
  expect(remoteEnduranceOptions(['--connection-cycles', '100', '--soak-seconds', '86400'])).toMatchObject({ connectionCycles: 100, soakSeconds: 86400 });
});
it('does not call an empty or interrupted wall-clock observation a complete functional day', () => {
  expect(soakCoverage(86400000, 1)).toMatchObject({ minimumSoakDurationMet: true, completeFunctionalSoak: false });
  expect(soakCoverage(3600000, 1200)).toMatchObject({ minimumSoakSamplesMet: true, completeFunctionalSoak: false });
  expect(soakCoverage(86400000, 1200).completeFunctionalSoak).toBe(true);
});
it('keeps fixture servers alive beyond the connection setup and the entire measured day', () => {
  const options = remoteEnduranceOptions(['--connection-cycles', '100', '--soak-seconds', '86400']);
  expect(fixtureLifetimeSeconds(options)).toBeGreaterThan(options.soakSeconds + options.connectionCycles * options.connectionIntervalMs / 1000);
  expect(fixtureLifetimeSeconds(remoteEnduranceOptions([]))).toBe(86400);
});
