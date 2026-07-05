import { afterEach, describe, expect, it } from 'vitest';

import { buildGatewayInstallPlan } from '../install-plan.js';

const originalExecArgv = [...process.execArgv];

afterEach(() => {
  process.execArgv = [...originalExecArgv];
});

describe('buildGatewayInstallPlan', () => {
  it('uses the source CLI entry point when installing from a source checkout', () => {
    process.execArgv = ['--import', 'tsx'];

    const plan = buildGatewayInstallPlan({ port: 18790, bind: 'loopback' });

    expect(plan.programArguments).toContain('gateway');
    expect(plan.programArguments).toContain('--foreground');
    expect(plan.programArguments).toContain('--port');
    expect(plan.programArguments).toContain('18790');
    expect(plan.programArguments.some((arg) => arg.replace(/\\/g, '/').endsWith('/src/cli/bin.ts'))).toBe(true);
  });

  it('does not persist transient eval arguments into the service command', () => {
    process.execArgv = ['--import', 'tsx', '-e', 'console.log("temporary")', '--inspect=127.0.0.1:9229'];

    const plan = buildGatewayInstallPlan({ port: 18790, bind: 'loopback' });

    expect(plan.programArguments).toContain('--import');
    expect(plan.programArguments).toContain('tsx');
    expect(plan.programArguments).not.toContain('-e');
    expect(plan.programArguments).not.toContain('console.log("temporary")');
    expect(plan.programArguments).not.toContain('--inspect=127.0.0.1:9229');
  });
});
