import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  playwrightChromiumDoctor,
  resolvePlaywrightCoreCliPath,
  resolvePlaywrightCoreRoot,
} from '../providers/playwright-doctor.js';

describe('playwrightChromiumDoctor', () => {
  const prevRoot = process.env.XOPC_PLAYWRIGHT_CORE_ROOT;
  afterEach(() => {
    if (prevRoot === undefined) delete process.env.XOPC_PLAYWRIGHT_CORE_ROOT;
    else process.env.XOPC_PLAYWRIGHT_CORE_ROOT = prevRoot;
  });

  it('resolves bundled playwright-core cli.js', () => {
    const cliPath = resolvePlaywrightCoreCliPath();
    expect(cliPath.endsWith('playwright-core/cli.js')).toBe(true);
    expect(existsSync(cliPath)).toBe(true);
  });

  it('honors XOPC_PLAYWRIGHT_CORE_ROOT for packaged Electron layout', () => {
    process.env.XOPC_PLAYWRIGHT_CORE_ROOT = resolvePlaywrightCoreRoot();
    const cliPath = resolvePlaywrightCoreCliPath();
    expect(cliPath.endsWith('playwright-core/cli.js')).toBe(true);
    expect(existsSync(cliPath)).toBe(true);
  });

  it('returns structured doctor payload', async () => {
    const result = await playwrightChromiumDoctor();
    expect(typeof result.installed).toBe('boolean');
    if (result.installed) {
      expect(result.executablePath).toBeTruthy();
    } else {
      expect(result.reason ?? result.executablePath).toBeTruthy();
    }
  });
});
