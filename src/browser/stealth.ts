/**
 * Stealth launch utilities for anti-detection browser automation.
 *
 * Provides argument deduplication, fingerprint seed generation, and
 * macOS quarantine attribute removal. Shared by CloakBrowser provider
 * and enhanced local launch paths.
 */

import { exec } from 'node:child_process';
import { stat, chmod } from 'node:fs/promises';
import { platform as osPlatform } from 'node:os';
import { promisify } from 'node:util';

import { createLogger } from '../utils/logger.js';

const execAsync = promisify(exec);
const log = createLogger('BrowserStealth');

// ── Stealth launch args ─────────────────────────────────────────────────────

export interface StealthOptions {
  /** Timezone to emulate (e.g. "America/New_York"). */
  timezone?: string;
  /** Locale to emulate (e.g. "en-US"). */
  locale?: string;
  /** Public IP for WebRTC leak prevention. */
  webrtcIp?: string;
  /** Platform to emulate in fingerprint (e.g. "windows", "macos"). */
  fingerprintPlatform?: string;
}

/**
 * Default Chromium args that reduce automation detectability.
 * Applied to both local Playwright and CloakBrowser launches.
 */
const BASE_STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-infobars',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions-except=',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
];

/**
 * Build stealth launch args with deduplication.
 * User `extraArgs` override any default args with the same `--key=` prefix.
 */
export function buildStealthArgs(
  extraArgs: string[] = [],
  options: StealthOptions = {},
): string[] {
  const argsMap = new Map<string, string>();
  const positionalArgs: string[] = [];

  // Insert defaults
  for (const arg of BASE_STEALTH_ARGS) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx >= 0) {
      argsMap.set(arg.slice(0, eqIdx), arg);
    } else {
      positionalArgs.push(arg);
    }
  }

  // Optional geo/locale/fingerprint args
  const fingerprintPlatform = options.fingerprintPlatform ?? detectFingerprintPlatform();
  argsMap.set('--fingerprint', `--fingerprint=${generateFingerprintSeed()}`);
  argsMap.set('--fingerprint-platform', `--fingerprint-platform=${fingerprintPlatform}`);

  if (options.timezone) {
    argsMap.set('--fingerprint-timezone', `--fingerprint-timezone=${options.timezone}`);
  }
  if (options.locale) {
    argsMap.set('--lang', `--lang=${options.locale}`);
    argsMap.set('--fingerprint-locale', `--fingerprint-locale=${options.locale}`);
  }
  if (options.webrtcIp) {
    argsMap.set('--fingerprint-webrtc-ip', `--fingerprint-webrtc-ip=${options.webrtcIp}`);
  }

  // User extra args override defaults (last wins)
  for (const arg of extraArgs) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx >= 0) {
      argsMap.set(arg.slice(0, eqIdx), arg);
    } else {
      positionalArgs.push(arg);
    }
  }

  // Collect: positional first, then key=value args (sorted for determinism)
  const kvArgs = [...argsMap.values()].sort();
  return [...positionalArgs, ...kvArgs];
}

/**
 * Basic stealth args for the local Playwright launcher (less aggressive than CloakBrowser).
 * Does not include fingerprint or geo args — just reduces automation signals.
 */
export function buildLocalStealthArgs(extraArgs: string[] = []): string[] {
  const baseArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
  ];

  const seen = new Set<string>();
  const result: string[] = [];

  // Extra args take priority — process them first to track keys
  for (const arg of extraArgs) {
    const key = arg.split('=')[0];
    if (!seen.has(key)) {
      seen.add(key);
      result.push(arg);
    }
  }

  for (const arg of baseArgs) {
    const key = arg.split('=')[0];
    if (!seen.has(key)) {
      seen.add(key);
      result.push(arg);
    }
  }

  return result;
}

// ── Fingerprint seed ────────────────────────────────────────────────────────

/** Generate a timestamp-based fingerprint seed for CloakBrowser. */
export function generateFingerprintSeed(): number {
  return Date.now();
}

/** Detect the fingerprint platform based on the current OS. */
function detectFingerprintPlatform(): string {
  const os = osPlatform();
  switch (os) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    default: return 'windows'; // Linux defaults to windows fingerprint to avoid detection
  }
}

// ── macOS quarantine removal ────────────────────────────────────────────────

/**
 * Remove the `com.apple.quarantine` extended attribute from a file or app bundle on macOS.
 * Files downloaded from the internet are tagged with this attribute, causing Gatekeeper
 * to block unsigned binaries. Without this, CloakBrowser silently fails to launch.
 *
 * Non-fatal — logs and returns on any error.
 */
export async function removeQuarantineAttr(path: string): Promise<void> {
  if (osPlatform() !== 'darwin') return;

  // Walk up to find .app bundle root
  const target = findAppBundle(path) ?? path;

  log.debug({ target }, 'Removing com.apple.quarantine');
  try {
    const { stderr } = await execAsync(`xattr -rd com.apple.quarantine "${target}"`);
    if (stderr?.trim()) {
      log.debug({ stderr: stderr.trim() }, 'xattr stderr (non-fatal)');
    }
    log.debug('Quarantine attribute removed');
  } catch {
    log.debug('xattr command failed or attribute not set (non-fatal)');
  }
}

/** Find the .app bundle root by walking up from an executable path. */
function findAppBundle(executablePath: string): string | undefined {
  const parts = executablePath.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].endsWith('.app')) {
      return parts.slice(0, i + 1).join('/');
    }
  }
  return undefined;
}

// ── navigator.webdriver override ────────────────────────────────────────────

/**
 * JavaScript snippet to inject into every new page to hide automation signals.
 * Removes `navigator.webdriver` and patches other detectable properties.
 */
export const WEBDRIVER_OVERRIDE_SCRIPT = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
if (navigator.plugins.length === 0) {
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });
}
Object.defineProperty(navigator, 'languages', {
  get: () => ['en-US', 'en'],
});
window.chrome = window.chrome || {};
window.chrome.runtime = window.chrome.runtime || {};
`;

// ── Make executable (cross-platform) ────────────────────────────────────────

/** Ensure a binary file has executable permissions (Unix only, no-op on Windows). */
export async function makeExecutable(path: string): Promise<void> {
  if (osPlatform() === 'win32') return;
  try {
    const stats = await stat(path);
    const mode = stats.mode | 0o111; // Add +x for owner/group/others
    await chmod(path, mode);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ path, errorMessage: msg }, `Failed to chmod binary: ${msg}`);
  }
}
