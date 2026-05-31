import { describe, expect, it } from 'vitest';

import {
  isGatewayRunFastPathArgv,
  resolveGatewayCatalogCommandPath,
  resolveGatewaySubcommandName,
} from '../gateway-run-argv.js';

describe('gateway run argv', () => {
  it('detects foreground gateway invocations', () => {
    expect(isGatewayRunFastPathArgv(['node', 'xopc', 'gateway'])).toBe(true);
    expect(isGatewayRunFastPathArgv(['node', 'xopc', '--config', '/tmp/x.json', 'gateway', '--port', '8080'])).toBe(
      true,
    );
  });

  it('rejects help, subcommands, and background mode', () => {
    expect(isGatewayRunFastPathArgv(['node', 'xopc', 'gateway', '--help'])).toBe(false);
    expect(isGatewayRunFastPathArgv(['node', 'xopc', 'gateway', 'status'])).toBe(false);
    expect(isGatewayRunFastPathArgv(['node', 'xopc', 'gateway', '--background'])).toBe(false);
  });

  it('resolves gateway catalog command paths', () => {
    expect(resolveGatewayCatalogCommandPath(['node', 'xopc', 'gateway'])).toEqual(['gateway']);
    expect(resolveGatewayCatalogCommandPath(['node', 'xopc', 'gateway', 'probe'])).toEqual([
      'gateway',
      'probe',
    ]);
    expect(resolveGatewayCatalogCommandPath(['node', 'xopc', 'config', 'show'])).toBeNull();
  });

  it('resolves gateway subcommand names', () => {
    expect(resolveGatewaySubcommandName(['node', 'xopc', 'gateway', 'stop'])).toBe('stop');
    expect(resolveGatewaySubcommandName(['node', 'xopc', 'gateway', '--port', '8080'])).toBeUndefined();
  });
});
