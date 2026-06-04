import { describe, expect, it } from 'vitest';

import { schtasksTestInternals } from '../schtasks.js';

describe('schtasks task generation', () => {
  it('generates a wrapper that injects environment before running gateway', () => {
    const wrapper = schtasksTestInternals.buildTaskWrapperContent({
      programArguments: ['C:\\Program Files\\nodejs\\node.exe', 'C:\\xopc checkout\\dist\\src\\cli\\bin.js', 'gateway'],
      workingDirectory: 'C:\\Users\\example\\.xopc',
      environment: {
        XOPC_CONFIG: 'C:\\Users\\example\\.xopc\\xopc.json',
        XOPC_GATEWAY_TOKEN: 'token%with&specials',
      },
    });

    expect(wrapper).toContain('set "XOPC_CONFIG=C:\\Users\\example\\.xopc\\xopc.json"');
    expect(wrapper).toContain('set "XOPC_GATEWAY_TOKEN=token%%with^&specials"');
    expect(wrapper).toContain('cd /d "C:\\Users\\example\\.xopc"');
    expect(wrapper).toContain('"C:\\Program Files\\nodejs\\node.exe" "C:\\xopc checkout\\dist\\src\\cli\\bin.js" "gateway"');
  });

  it('generates task XML with on-logon start and failure restart policy', () => {
    const xml = schtasksTestInternals.buildTaskXml({
      description: 'xopc Gateway (v0.0.86)',
      wrapperPath: 'C:\\Users\\example\\.xopc\\daemon\\xopc-gateway.cmd',
      workingDirectory: 'C:\\Users\\example\\.xopc',
    });

    expect(xml).toContain('<LogonTrigger>');
    expect(xml).toContain('<StartWhenAvailable>true</StartWhenAvailable>');
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>');
    expect(xml).toContain('<RestartOnFailure>');
    expect(xml).toContain('<Interval>PT1M</Interval>');
    expect(xml).toContain('<Count>999</Count>');
    expect(xml).toContain('<Command>C:\\Users\\example\\.xopc\\daemon\\xopc-gateway.cmd</Command>');
  });
});
