import { describe, expect, it } from 'vitest';

import { desktopPairingRouteSchema, desktopSshOriginSchema } from './desktop-host.js';
import { devicePairingRouteSchema } from './device-pairing.js';

describe('desktop SSH pairing boundary', () => {
  it.each(['http://127.0.0.1:18790', 'http://[::1]:18790', 'http://localhost:18790'])('accepts only an explicit desktop loopback route: %s', url => {
    expect(desktopSshOriginSchema.safeParse(url).success).toBe(true);
    expect(desktopPairingRouteSchema.safeParse({ id: 'ssh', kind: 'ssh-loopback', url }).success).toBe(true);
    expect(devicePairingRouteSchema.safeParse({ id: 'ssh', kind: 'ssh-loopback', url }).success).toBe(false);
  });
  it.each(['http://example.com', 'http://0.0.0.0:18790', 'http://127.1:18790', 'http://127.0.0.1:18790/',
    'http://user:password@127.0.0.1:18790', 'http://localhost:18790?token=value', 'https://localhost:18790'])('rejects a noncanonical SSH target: %s', url => {
    expect(desktopSshOriginSchema.safeParse(url).success).toBe(false);
  });
});
