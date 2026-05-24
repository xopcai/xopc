import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { runExec, type ExecResult } from './exec.js';

function parsePossiblyNoisyJsonObject(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  }
  return JSON.parse(trimmed) as Record<string, unknown>;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isTailnetIPv4(ip: string): boolean {
  const trimmed = ip.trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
    return false;
  }
  return trimmed.startsWith('100.');
}

function parseTailnetIpv4Lines(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const ip = line.trim();
    if (isTailnetIPv4(ip)) {
      return ip;
    }
  }
  return undefined;
}

async function checkBinary(path: string): Promise<boolean> {
  if (!path || !existsSync(path)) {
    return false;
  }
  try {
    await Promise.race([
      runExec(path, ['--version'], { timeoutMs: 3000 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function findTailscaleBinary(): Promise<string | null> {
  try {
    const { stdout } = await runExec('which', ['tailscale'], { timeoutMs: 3000 });
    const fromPath = stdout.trim();
    if (fromPath && (await checkBinary(fromPath))) {
      return fromPath;
    }
  } catch {
    // continue
  }

  const macAppPath = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  if (await checkBinary(macAppPath)) {
    return macAppPath;
  }

  try {
    const { stdout } = await runExec(
      'find',
      [
        '/Applications',
        '-maxdepth',
        '3',
        '-name',
        'Tailscale',
        '-path',
        '*/Tailscale.app/Contents/MacOS/Tailscale',
      ],
      { timeoutMs: 5000 },
    );
    const found = stdout.trim().split('\n')[0];
    if (found && (await checkBinary(found))) {
      return found;
    }
  } catch {
    // continue
  }

  return null;
}

let cachedTailscaleBinary: string | null = null;

export function getTestTailscaleBinaryOverride(env: NodeJS.ProcessEnv = process.env): string | null {
  const forcedBinary = env.XOPC_TEST_TAILSCALE_BINARY?.trim();
  if (!forcedBinary) {
    return null;
  }
  if (env.VITEST || env.NODE_ENV === 'test') {
    return forcedBinary;
  }
  return null;
}

export async function getTailscaleBinary(): Promise<string> {
  const forcedBinary = getTestTailscaleBinaryOverride();
  if (forcedBinary) {
    cachedTailscaleBinary = forcedBinary;
    return forcedBinary;
  }
  if (cachedTailscaleBinary) {
    return cachedTailscaleBinary;
  }
  cachedTailscaleBinary = await findTailscaleBinary();
  return cachedTailscaleBinary ?? 'tailscale';
}

export function resetTailscaleBinaryCacheForTest(): void {
  cachedTailscaleBinary = null;
}

function findTailscaleBinarySync(): string {
  const forced = getTestTailscaleBinaryOverride();
  if (forced) {
    return forced;
  }
  if (cachedTailscaleBinary) {
    return cachedTailscaleBinary;
  }
  const macAppPath = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  if (existsSync(macAppPath)) {
    return macAppPath;
  }
  return 'tailscale';
}

export function getTailnetIPv4Sync(): string | undefined {
  try {
    const bin = findTailscaleBinarySync();
    const stdout = execFileSync(bin, ['ip', '-4'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    return parseTailnetIpv4Lines(stdout);
  } catch {
    return undefined;
  }
}

export async function getTailnetIPv4(): Promise<string | undefined> {
  try {
    const bin = await getTailscaleBinary();
    const { stdout } = await runExec(bin, ['ip', '-4'], { timeoutMs: 5000 });
    return parseTailnetIpv4Lines(stdout);
  } catch {
    return undefined;
  }
}

export async function getTailnetHostname(exec: typeof runExec = runExec): Promise<string> {
  const tailscaleBin = await getTailscaleBinary();
  const { stdout } = await exec(tailscaleBin, ['status', '--json'], {
    timeoutMs: 5000,
    maxBuffer: 400_000,
  });
  const parsed = stdout ? parsePossiblyNoisyJsonObject(stdout) : {};
  const self =
    typeof parsed.Self === 'object' && parsed.Self !== null
      ? (parsed.Self as Record<string, unknown>)
      : undefined;
  const dns = typeof self?.DNSName === 'string' ? self.DNSName : undefined;
  const ips = Array.isArray(self?.TailscaleIPs)
    ? ((parsed.Self as { TailscaleIPs?: string[] }).TailscaleIPs ?? [])
    : [];
  if (dns && dns.length > 0) {
    return dns.replace(/\.$/, '');
  }
  if (ips.length > 0) {
    return ips[0]!;
  }
  throw new Error('Could not determine Tailscale DNS or IP');
}

type ExecErrorDetails = {
  stdout?: unknown;
  stderr?: unknown;
  message?: unknown;
  code?: unknown;
};

function extractExecErrorText(err: unknown) {
  const errOutput = err as ExecErrorDetails;
  const stdout = typeof errOutput.stdout === 'string' ? errOutput.stdout : '';
  const stderr = typeof errOutput.stderr === 'string' ? errOutput.stderr : '';
  const message = typeof errOutput.message === 'string' ? errOutput.message : '';
  const code = typeof errOutput.code === 'string' ? errOutput.code : '';
  return { stdout, stderr, message, code };
}

function isPermissionDeniedError(err: unknown): boolean {
  const { stdout, stderr, message, code } = extractExecErrorText(err);
  if (code.toUpperCase() === 'EACCES') {
    return true;
  }
  const combined = `${stdout}\n${stderr}\n${message}`.toLowerCase();
  return (
    combined.includes('permission denied') ||
    combined.includes('access denied') ||
    combined.includes('operation not permitted') ||
    combined.includes('requires root') ||
    combined.includes('must be run as root') ||
    combined.includes('requires sudo')
  );
}

async function execWithSudoFallback(
  exec: typeof runExec,
  bin: string,
  args: string[],
  opts: { maxBuffer?: number; timeoutMs?: number },
): Promise<ExecResult> {
  try {
    return await exec(bin, args, opts);
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      throw err;
    }
    try {
      return await exec('sudo', ['-n', bin, ...args], opts);
    } catch {
      throw err;
    }
  }
}

export async function enableTailscaleServe(port: number, exec: typeof runExec = runExec): Promise<void> {
  const tailscaleBin = await getTailscaleBinary();
  await execWithSudoFallback(exec, tailscaleBin, ['serve', '--bg', '--yes', `${port}`], {
    maxBuffer: 200_000,
    timeoutMs: 15_000,
  });
}

export async function disableTailscaleServe(exec: typeof runExec = runExec): Promise<void> {
  const tailscaleBin = await getTailscaleBinary();
  await execWithSudoFallback(exec, tailscaleBin, ['serve', 'reset'], {
    maxBuffer: 200_000,
    timeoutMs: 15_000,
  });
}

export async function enableTailscaleFunnel(port: number, exec: typeof runExec = runExec): Promise<void> {
  const tailscaleBin = await getTailscaleBinary();
  await execWithSudoFallback(exec, tailscaleBin, ['funnel', '--bg', '--yes', `${port}`], {
    maxBuffer: 200_000,
    timeoutMs: 15_000,
  });
}

export async function disableTailscaleFunnel(exec: typeof runExec = runExec): Promise<void> {
  const tailscaleBin = await getTailscaleBinary();
  await execWithSudoFallback(exec, tailscaleBin, ['funnel', 'reset'], {
    maxBuffer: 200_000,
    timeoutMs: 15_000,
  });
}

export type TailscaleWhoisIdentity = {
  login: string;
  name?: string;
};

const whoisCache = new Map<string, { value: TailscaleWhoisIdentity | null; expiresAt: number }>();

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseWhoisIdentity(payload: Record<string, unknown>): TailscaleWhoisIdentity | null {
  const userProfile =
    readRecord(payload.UserProfile) ?? readRecord(payload.userProfile) ?? readRecord(payload.User);
  const login =
    normalizeOptionalString(userProfile?.LoginName) ??
    normalizeOptionalString(userProfile?.Login) ??
    normalizeOptionalString(userProfile?.login) ??
    normalizeOptionalString(payload.LoginName) ??
    normalizeOptionalString(payload.login);
  if (!login) {
    return null;
  }
  const name =
    normalizeOptionalString(userProfile?.DisplayName) ??
    normalizeOptionalString(userProfile?.Name) ??
    normalizeOptionalString(userProfile?.displayName) ??
    normalizeOptionalString(payload.DisplayName) ??
    normalizeOptionalString(payload.name);
  return { login, name };
}

export async function readTailscaleWhoisIdentity(
  ip: string,
  exec: typeof runExec = runExec,
  opts?: { timeoutMs?: number; cacheTtlMs?: number; errorTtlMs?: number },
): Promise<TailscaleWhoisIdentity | null> {
  const normalized = ip.trim();
  if (!normalized) {
    return null;
  }
  const now = Date.now();
  const cached = whoisCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const cacheTtlMs = opts?.cacheTtlMs ?? 60_000;
  const errorTtlMs = opts?.errorTtlMs ?? 5_000;
  try {
    const tailscaleBin = await getTailscaleBinary();
    const { stdout } = await exec(tailscaleBin, ['whois', '--json', normalized], {
      timeoutMs: opts?.timeoutMs ?? 5_000,
      maxBuffer: 200_000,
    });
    const parsed = stdout ? parsePossiblyNoisyJsonObject(stdout) : {};
    const identity = parseWhoisIdentity(parsed);
    whoisCache.set(normalized, { value: identity, expiresAt: Date.now() + cacheTtlMs });
    return identity;
  } catch {
    whoisCache.set(normalized, { value: null, expiresAt: Date.now() + errorTtlMs });
    return null;
  }
}

export async function isTailscaleInstalled(): Promise<boolean> {
  const bin = await findTailscaleBinary();
  return bin !== null;
}
