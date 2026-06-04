import { describe, expect, it } from 'vitest';

import { buildSystemdUnit } from '../systemd.js';

describe('buildSystemdUnit', () => {
  it('configures restart policy for long-running gateway service', () => {
    const unit = buildSystemdUnit({
      description: 'xopc Gateway',
      programArguments: ['/usr/bin/node', '/opt/xopc/dist/src/cli/bin.js', 'gateway', '--foreground'],
      workingDirectory: '/home/example/.xopc',
      environment: {
        XOPC_SERVICE_MARKER: '1',
      },
    });

    expect(unit).toContain('Type=simple');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('RestartSec=5');
    expect(unit).toContain('RestartPreventExitStatus=78');
    expect(unit).toContain('KillMode=control-group');
    expect(unit).toContain('WantedBy=default.target');
  });

  it('quotes ExecStart arguments that contain spaces', () => {
    const unit = buildSystemdUnit({
      description: 'xopc Gateway',
      programArguments: ['/usr/bin/node', '/home/example/xopc checkout/src/cli/bin.ts', 'gateway', '--foreground'],
      workingDirectory: '/home/example/.xopc',
      environment: {},
    });

    expect(unit).toContain('ExecStart=/usr/bin/node "/home/example/xopc checkout/src/cli/bin.ts" gateway --foreground');
  });

  it('escapes systemd specifiers in environment values', () => {
    const unit = buildSystemdUnit({
      description: 'xopc Gateway',
      programArguments: ['/usr/bin/node', '/opt/xopc/dist/src/cli/bin.js', 'gateway'],
      environment: {
        XOPC_GATEWAY_TOKEN: 'token%with"quote',
      },
    });

    expect(unit).toContain('Environment="XOPC_GATEWAY_TOKEN=token%%with\\"quote"');
  });
});
