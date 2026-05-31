import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PlaywrightChromiumDoctorResult {
  installed: boolean;
  executablePath?: string | null;
  reason?: string;
}

/** Root directory of the `playwright-core` package (Electron extraResources or node_modules). */
export function resolvePlaywrightCoreRoot(): string {
  const envRoot = process.env.XOPC_PLAYWRIGHT_CORE_ROOT?.trim();
  if (envRoot) {
    const pkgJson = join(envRoot, 'package.json');
    if (!existsSync(pkgJson)) {
      throw new Error(`playwright-core package.json not found under XOPC_PLAYWRIGHT_CORE_ROOT (${envRoot})`);
    }
    return envRoot;
  }

  const require = createRequire(fileURLToPath(import.meta.url));
  const pkgJson = require.resolve('playwright-core/package.json');
  return dirname(pkgJson);
}

/** Absolute path to bundled `playwright-core/cli.js` (same revision as runtime). */
export function resolvePlaywrightCoreCliPath(): string {
  return join(resolvePlaywrightCoreRoot(), 'cli.js');
}

async function loadPlaywrightCoreModule(): Promise<typeof import('playwright-core')> {
  const envRoot = process.env.XOPC_PLAYWRIGHT_CORE_ROOT?.trim();
  if (envRoot) {
    const pkgJson = join(envRoot, 'package.json');
    const require = createRequire(pkgJson);
    return require('playwright-core') as typeof import('playwright-core');
  }
  return import('playwright-core');
}

/** Check whether playwright-core's default Chromium revision is on disk. */
export async function playwrightChromiumDoctor(): Promise<PlaywrightChromiumDoctorResult> {
  try {
    const pw = await loadPlaywrightCoreModule();
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
