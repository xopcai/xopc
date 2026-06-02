import { describe, expect, it } from 'vitest';
import { isGatewayArgv, parseProcCmdline } from '../../infra/gateway-process-argv.js';

describe('gateway-process-argv', () => {
  it('parses linux cmdline', () => {
    expect(parseProcCmdline('node\x00xopc\x00gateway\x00--port\x0018790')).toEqual([
      'node',
      'xopc',
      'gateway',
      '--port',
      '18790',
    ]);
  });

  it('recognizes xopc gateway argv', () => {
    expect(isGatewayArgv(['node', '/usr/local/bin/xopc', 'gateway', '--foreground'])).toBe(true);
    expect(isGatewayArgv(['node', '/path/dist/cli/index.js', 'gateway'])).toBe(true);
    expect(isGatewayArgv(['python', 'app.py'])).toBe(false);
  });
});
