import { PACKAGE_VERSION } from '../../../../package-version.js';
import type { CheckResult, DoctorContext } from '../types.js';

const REGISTRY_URL = 'https://registry.npmjs.org/@xopcai/xopc/latest';
const TIMEOUT_MS = 5000;

/** Simple semver: 1 if a > b, -1 if a < b, 0 if equal. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function checkVersionUpdate(_ctx: DoctorContext): Promise<CheckResult> {
  const local = PACKAGE_VERSION.trim() || '0.0.0';
  const latest = await fetchLatestVersion();
  if (!latest) {
    return {
      id: 'version-check',
      label: 'Version',
      status: 'skip',
      message: 'Could not query npm for the latest version (offline or registry error).',
      hints: [],
    };
  }

  if (compareSemver(latest, local) > 0) {
    return {
      id: 'version-check',
      label: 'Version',
      status: 'warn',
      message: `Running v${local}; npm latest is v${latest}.`,
      hints: ['Upgrade: pnpm add -g @xopcai/xopc@latest', 'Or: npm i -g @xopcai/xopc@latest'],
    };
  }

  if (compareSemver(local, latest) > 0) {
    return {
      id: 'version-check',
      label: 'Version',
      status: 'pass',
      message: `Running v${local} (ahead of npm registry v${latest}; local/dev build is OK).`,
      hints: [],
    };
  }

  return {
    id: 'version-check',
    label: 'Version',
    status: 'pass',
    message: `Running v${local} (matches npm latest).`,
    hints: [],
  };
}
