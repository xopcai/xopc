import { describe, expect, it } from 'vitest';

import { buildLaunchAgentPlist } from '../launchd.js';

describe('buildLaunchAgentPlist', () => {
  it('keeps the gateway alive even after clean exits', () => {
    const plist = buildLaunchAgentPlist({
      label: 'ai.xopc.gateway',
      programArguments: ['/usr/local/bin/node', '/usr/local/bin/xopc', 'gateway', '--foreground'],
      workingDirectory: '/Users/example/.xopc',
      environment: {
        XOPC_CONFIG: '/Users/example/.xopc/xopc.json',
        XOPC_SERVICE_MARKER: '1',
      },
      stdoutPath: '/Users/example/.xopc/logs/gateway.log',
      stderrPath: '/Users/example/.xopc/logs/gateway.err.log',
    });

    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<true/>');
    expect(plist).not.toContain('<key>SuccessfulExit</key>');
  });
});
