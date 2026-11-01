import { describe, expect, it } from 'vitest';

import { desktopPairingRouteSchema, desktopSshOriginSchema, desktopExecutionGrantSchema } from './desktop-host.js';
import { devicePairingRouteSchema } from './device-pairing.js';

describe('desktop SSH pairing boundary', () => {
  it.each(['desktop.computer.remote_control', 'desktop.browser.control'])('keeps %s separate from other execution capabilities', tool => {
    const grant = { version: 1, grantId: '11111111-1111-4111-8111-111111111111', localApprovalId: '22222222-2222-4222-8222-222222222222', expiresAt: Date.now() + 120000,
      toolRevisions: { [tool]: 'a'.repeat(64), 'desktop.operation.get_status': 'b'.repeat(64) } };
    expect(desktopExecutionGrantSchema.safeParse(grant).success).toBe(true);
    for (const forbidden of ['desktop.clipboard.write', 'desktop.workspace.write', 'desktop.command.run', 'desktop.terminal.open', 'desktop.computer.control', 'desktop.computer.remote_control', 'desktop.browser.control'].filter(name => name !== tool)) {
      expect(desktopExecutionGrantSchema.safeParse({ ...grant, toolRevisions: { ...grant.toolRevisions, [forbidden]: 'c'.repeat(64) } }).success).toBe(false);
    }
    expect(desktopExecutionGrantSchema.safeParse({ ...grant, workspaceId: grant.grantId }).success).toBe(false);
  });
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
