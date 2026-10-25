import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { deviceEnvironmentText } from '../device-environment.js';
import { unsupportedPhoneEnvironmentAdapter } from '../../../phone/environment-adapter.js';

it('rechecks queued context freshness at injection and does not inject unapproved fields', () => {
  const text = JSON.stringify({ environment: { capturedAt: 0, timezone: 'UTC' }, taskContext: {
    version: 1, endpointId: 'phone', revision: 1, availability: 'foreground', fields: {
      'environment.timezone': { status: 'fresh', value: 'Asia/Shanghai', capturedAt: 1_000, validUntil: 301_000 },
      'device.power': { status: 'fresh', value: { batteryPercent: 50, charging: false }, capturedAt: 1_000, validUntil: 31_000 },
      'physical.location': { status: 'fresh', value: { latitude: 12, longitude: 34 }, capturedAt: 1_000, validUntil: 31_000 },
    },
  } });
  const value = JSON.parse(deviceEnvironmentText({ kind: 'device_context', sourceId: 'phone', version: 'v1', text }, 40_000));
  expect(value.taskContext.fields['device.power']).not.toHaveProperty('value');
  expect(value.taskContext.fields['physical.location']).toBeUndefined();
  expect(value.taskContext.fields['environment.timezone'].value).toBe('Asia/Shanghai');
  const expired = JSON.parse(deviceEnvironmentText({ kind: 'device_context', sourceId: 'phone', version: 'v1', text }, 400_000));
  expect(expired.environment).toBeUndefined();
  expect(expired.taskContext.fields['environment.timezone']).not.toHaveProperty('value');
});

it('reserves the phone adapter without performing environment writes', async () => {
  expect(unsupportedPhoneEnvironmentAdapter.supportedFields).toEqual([]);
  expect(await unsupportedPhoneEnvironmentAdapter.apply({ phoneRef: 'phone', purpose: 'phone_task', bindings: [] }, new AbortController().signal))
    .toEqual({ status: 'unsupported' });
});

it('injects only source-matched location metadata and drops expired references', () => {
  const share = { id: randomUUID(), endpointId: 'phone', conversationId: randomUUID(), precision: 'precise',
    mode: 'once', expiresAt: 80_000, validUntil: 31_000, capturedAt: 1_000, status: 'fresh', sync: 'applied',
    valueRef: randomUUID(), latitude: 31.234567, longitude: 121.345678 };
  const context = { kind: 'device_context' as const, sourceId: 'phone', version: 'v1',
    text: JSON.stringify({ locationShares: [share, { ...share, endpointId: 'another-device' }] }) };
  const fresh = JSON.parse(deviceEnvironmentText(context, 20_000));
  expect(fresh.locationShares).toHaveLength(1);
  expect(fresh.locationShares[0].valueRef).toBe(share.valueRef);
  expect(fresh.locationShares[0]).not.toHaveProperty('latitude');
  const stale = JSON.parse(deviceEnvironmentText(context, 40_000));
  expect(stale.locationShares[0]).toMatchObject({ status: 'stale' });
  expect(stale.locationShares[0]).not.toHaveProperty('valueRef');
});
