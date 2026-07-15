import { describe, expect, it } from 'vitest';

import { resolveTuiOptions } from '../commands/tui-runner.js';

describe('resolveTuiOptions', () => {
  it('configures the startup session picker for interactive resume', () => {
    expect(
      resolveTuiOptions(
        { local: true, theme: 'dark' },
        { openSessionPickerOnStart: true },
      ),
    ).toMatchObject({
      local: true,
      theme: 'dark',
      useStartupCwd: true,
      openSessionPickerOnStart: true,
    });
  });

  it('uses an explicit resume session in preference to CLI session options', () => {
    expect(
      resolveTuiOptions(
        { session: 'stale-session', token: ' gateway-token ' },
        { session: 'agent:main:tui-restored' },
      ),
    ).toMatchObject({
      session: 'agent:main:tui-restored',
      credential: { kind: 'token', value: 'gateway-token' },
      local: false,
    });
  });

  it('rejects conflicting gateway credentials', () => {
    expect(() =>
      resolveTuiOptions({ token: 'token', passwordEnv: 'XOPC_GATEWAY_PASSWORD' }),
    ).toThrow('Use either --token or --password-env, not both.');
  });
});
