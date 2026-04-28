/**
 * Light semver range check for `manifest.engines.xopc` without a `semver` dependency.
 * Supports: ^, ~, >=, >, <=, <, =, exact, space-combined (AND). No ||, x-ranges, or pre-release.
 */

export interface EngineCheckResult {
  compatible: boolean;
  reason?: string;
  parseWarning?: boolean;
}

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(s: string): SemVer | null {
  const t = s.trim().replace(/^v/i, '');
  const m = t.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: +m[1]!, minor: +m[2]!, patch: +m[3]! };
}

function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

const gte = (a: SemVer, b: SemVer) => compareSemver(a, b) >= 0;
const gt = (a: SemVer, b: SemVer) => compareSemver(a, b) > 0;
const lt = (a: SemVer, b: SemVer) => compareSemver(a, b) < 0;
const lte = (a: SemVer, b: SemVer) => compareSemver(a, b) <= 0;
const eq = (a: SemVer, b: SemVer) => compareSemver(a, b) === 0;

function checkToken(current: SemVer, token: string): { sat: boolean; warn: boolean } {
  const t = token.trim();
  if (!t) return { sat: true, warn: false };

  if (t.startsWith('^')) {
    const v = parseSemver(t.slice(1).trim());
    if (!v) return { sat: true, warn: true };
    const upper: SemVer = { major: v.major + 1, minor: 0, patch: 0 };
    return { sat: gte(current, v) && lt(current, upper), warn: false };
  }

  if (t.startsWith('~')) {
    const v = parseSemver(t.slice(1).trim());
    if (!v) return { sat: true, warn: true };
    const upper: SemVer = { major: v.major, minor: v.minor + 1, patch: 0 };
    return { sat: gte(current, v) && lt(current, upper), warn: false };
  }

  const comp = t.match(/^(>=|<=|>|=|<)\s*(.+)$/);
  if (comp) {
    const op = comp[1]!;
    const v = parseSemver(String(comp[2] ?? '').trim());
    if (!v) return { sat: true, warn: true };
    switch (op) {
      case '>=':
        return { sat: gte(current, v), warn: false };
      case '<=':
        return { sat: lte(current, v), warn: false };
      case '>':
        return { sat: gt(current, v), warn: false };
      case '<':
        return { sat: lt(current, v), warn: false };
      case '=':
        return { sat: eq(current, v), warn: false };
      default:
        return { sat: true, warn: true };
    }
  }

  const exact = parseSemver(t);
  if (exact) {
    return { sat: eq(current, exact), warn: false };
  }

  return { sat: true, warn: true };
}

/**
 * @param currentVersion — e.g. from `PACKAGE_VERSION`
 * @param requiredRange — e.g. `">=1.0.0 <2.0.0"` or `"^0.0.1"`
 */
export function checkEngineCompatibility(
  currentVersion: string,
  requiredRange: string,
): EngineCheckResult {
  const current = parseSemver(currentVersion.trim());
  if (!current) {
    return {
      compatible: true,
      parseWarning: true,
      reason: `Current xopc version could not be parsed: ${currentVersion}`,
    };
  }

  const range = requiredRange.trim();
  if (!range) {
    return { compatible: true, parseWarning: true };
  }

  const parts = range.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { compatible: true, parseWarning: true };
  }

  let anyWarn = false;
  for (const p of parts) {
    const { sat, warn } = checkToken(current, p);
    if (warn) {
      anyWarn = true;
      continue;
    }
    if (!sat) {
      return {
        compatible: false,
        reason: `xopc version ${currentVersion} does not satisfy engines.xopc: "${requiredRange}"`,
      };
    }
  }

  if (anyWarn) {
    return {
      compatible: true,
      parseWarning: true,
      reason: `Could not fully parse engines.xopc range: "${requiredRange}"`,
    };
  }

  return { compatible: true };
}
