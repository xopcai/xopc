import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PlaywrightChromiumDoctorResult {
  installed: boolean;
  executablePath?: string | null;
  reason?: string;
}

/** Absolute path to bundled `playwright-core/cli.js` (same revision as runtime). */
export function resolvePlaywrightCoreCliPath(): string {
  const require = createRequire(fileURLToPath(import.meta.url));
  const pkgJson = require.resolve('playwright-core/package.json');
  return join(dirname(pkgJson), 'cli.js');
}

/** Check whether playwright-core's default Chromium revision is on disk. */
export async function playwrightChromiumDoctor(): Promise<PlaywrightChromiumDoctorResult> {
  try {
    const pw = await import('playwright-core');
    const chromium = pw.chromium
      ?? (pw as { default?: { chromium?: (typeof pw)['chromium'] } }).default?.chromium;
    if (!chromium?.executablePath) {
      return { installed: false, reason: 'playwright-core missing' };
    }

    let executablePath: string;
    try {
      executablePath = chromium.executablePath();
    } catch (err) {
      return {
        installed: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const st = await stat(executablePath);
      return { installed: st.isFile(), executablePath };
    } catch {
      return {
        installed: false,
        executablePath,
        reason: 'Chromium executable not found on disk',
      };
    }
  } catch (e) {
    return { installed: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
