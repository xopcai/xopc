import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface BrowserSettingsState {
  enabled: boolean;
  driverKind: 'extension' | 'playwright' | 'cdp' | 'remote';
  headless: boolean;
  executablePath: string;
  cdpEndpoint: string;
  remoteProvider: 'browserbase' | 'browser-use';
  remoteApiKey: string;
  remoteProjectId: string;
  remoteRegion: string;
  maxNodes: number;
  maxCharacters: number;
  visualFallback: boolean;
  actionTimeoutMs: number;
  sessionTimeoutMs: number;
  maxSequenceLength: number;
  allowedPrivateHosts: string;
  crossDomainNavigation: 'allow' | 'ask' | 'deny';
  uploads: 'allow' | 'ask' | 'deny';
  consequentialActions: 'allow' | 'ask' | 'deny';
}

const defaults: BrowserSettingsState = {
  enabled: true,
  driverKind: 'extension',
  headless: false,
  executablePath: '',
  cdpEndpoint: 'http://127.0.0.1:9222',
  remoteProvider: 'browserbase',
  remoteApiKey: '',
  remoteProjectId: '',
  remoteRegion: '',
  maxNodes: 180,
  maxCharacters: 12_000,
  visualFallback: true,
  actionTimeoutMs: 30_000,
  sessionTimeoutMs: 900_000,
  maxSequenceLength: 5,
  allowedPrivateHosts: '',
  crossDomainNavigation: 'ask',
  uploads: 'ask',
  consequentialActions: 'ask',
};

export function parseBrowserSettings(config: unknown): BrowserSettingsState {
  const root = record(config);
  const browser = record(root.browser);
  const driver = record(browser.driver);
  const observation = record(browser.observation);
  const limits = record(browser.limits);
  const security = record(browser.security);
  const kind = driver.kind;
  return {
    ...defaults,
    enabled: browser.enabled !== false,
    driverKind: kind === 'playwright' || kind === 'cdp' || kind === 'remote' ? kind : 'extension',
    headless: driver.headless === true,
    executablePath: stringValue(driver.executablePath, ''),
    cdpEndpoint: stringValue(driver.endpoint, defaults.cdpEndpoint),
    remoteProvider: driver.provider === 'browser-use' ? 'browser-use' : 'browserbase',
    remoteApiKey: stringValue(driver.apiKey, ''),
    remoteProjectId: stringValue(driver.projectId, ''),
    remoteRegion: stringValue(driver.region, ''),
    maxNodes: numberValue(observation.maxNodes, defaults.maxNodes),
    maxCharacters: numberValue(observation.maxCharacters, defaults.maxCharacters),
    visualFallback: observation.visualFallback !== false,
    actionTimeoutMs: numberValue(limits.actionTimeoutMs, defaults.actionTimeoutMs),
    sessionTimeoutMs: numberValue(limits.sessionTimeoutMs, defaults.sessionTimeoutMs),
    maxSequenceLength: numberValue(limits.maxSequenceLength, defaults.maxSequenceLength),
    allowedPrivateHosts: Array.isArray(security.allowedPrivateHosts) ? security.allowedPrivateHosts.filter((value): value is string => typeof value === 'string').join('\n') : '',
    crossDomainNavigation: policy(security.crossDomainNavigation),
    uploads: policy(security.uploads),
    consequentialActions: policy(security.consequentialActions),
  };
}

export function buildBrowserConfig(state: BrowserSettingsState): Record<string, unknown> {
  const driver = state.driverKind === 'extension'
    ? { kind: 'extension' }
    : state.driverKind === 'playwright'
      ? { kind: 'playwright', headless: state.headless, ...(state.executablePath.trim() ? { executablePath: state.executablePath.trim() } : {}) }
      : state.driverKind === 'cdp'
        ? { kind: 'cdp', endpoint: state.cdpEndpoint.trim() }
        : { kind: 'remote', provider: state.remoteProvider, ...(state.remoteApiKey.trim() ? { apiKey: state.remoteApiKey.trim() } : {}), ...(state.remoteProjectId.trim() ? { projectId: state.remoteProjectId.trim() } : {}), ...(state.remoteRegion.trim() ? { region: state.remoteRegion.trim() } : {}) };
  return {
    enabled: state.enabled,
    driver,
    observation: { maxNodes: state.maxNodes, maxCharacters: state.maxCharacters, visualFallback: state.visualFallback },
    limits: { actionTimeoutMs: state.actionTimeoutMs, sessionTimeoutMs: state.sessionTimeoutMs, maxSequenceLength: state.maxSequenceLength },
    security: {
      privateNetworks: 'deny',
      allowedPrivateHosts: state.allowedPrivateHosts.split('\n').map((host) => host.trim()).filter(Boolean),
      crossDomainNavigation: state.crossDomainNavigation,
      uploads: state.uploads,
      consequentialActions: state.consequentialActions,
    },
  };
}

export function validateBrowserSettings(state: BrowserSettingsState): string | null {
  if (state.driverKind === 'cdp') {
    try {
      const endpoint = new URL(state.cdpEndpoint);
      if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:' && endpoint.protocol !== 'ws:' && endpoint.protocol !== 'wss:') {
        return 'CDP endpoint must use http, https, ws, or wss.';
      }
    } catch {
      return 'Enter a valid CDP endpoint URL.';
    }
  }
  if (!Number.isInteger(state.maxNodes) || state.maxNodes < 20 || state.maxNodes > 500) return 'Max nodes must be between 20 and 500.';
  if (!Number.isInteger(state.maxCharacters) || state.maxCharacters < 1_000 || state.maxCharacters > 50_000) return 'Max characters must be between 1,000 and 50,000.';
  if (!Number.isInteger(state.actionTimeoutMs) || state.actionTimeoutMs < 1_000 || state.actionTimeoutMs > 120_000) return 'Action timeout must be between 1,000 and 120,000 ms.';
  if (!Number.isInteger(state.sessionTimeoutMs) || state.sessionTimeoutMs < 60_000 || state.sessionTimeoutMs > 3_600_000) return 'Session timeout must be between 60,000 and 3,600,000 ms.';
  if (!Number.isInteger(state.maxSequenceLength) || state.maxSequenceLength < 1 || state.maxSequenceLength > 10) return 'Sequence length must be between 1 and 10.';
  return null;
}

export async function patchBrowserSettings(state: BrowserSettingsState): Promise<void> {
  await fetchJson(apiUrl('/api/config'), { method: 'PATCH', body: JSON.stringify({ browser: buildBrowserConfig(state) }) });
  void revalidateGatewayConfig();
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown, fallback: string): string { return typeof value === 'string' ? value : fallback; }
function numberValue(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function policy(value: unknown): 'allow' | 'ask' | 'deny' { return value === 'allow' || value === 'deny' ? value : 'ask'; }
