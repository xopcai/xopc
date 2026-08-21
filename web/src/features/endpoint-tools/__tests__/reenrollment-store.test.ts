import { afterEach, describe, expect, it } from 'vitest';

import {
  requestEndpointReenrollment,
  settleEndpointReenrollment,
} from '../reenrollment-store';

describe('endpoint reenrollment store', () => {
  afterEach(() => settleEndpointReenrollment(false));

  it('requires an explicit user decision', async () => {
    const decision = requestEndpointReenrollment();
    settleEndpointReenrollment(true);
    await expect(decision).resolves.toBe(true);
  });
});
