import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  playwrightChromiumDoctor,
  resolvePlaywrightCoreCliPath,
} from '../providers/playwright-doctor.js';

describe('playwrightChromiumDoctor', () => {
  it('resolves bundled playwright-core cli.js', () => {
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
