/** Discriminated payload emitted by `browser_use` when preflight fails. */
export type BrowserSetupRequiredPayload = {
  kind: 'browser_setup_required';
  backend: 'extension' | 'local' | 'cloakbrowser' | 'cdp' | 'cloud';
  reason:
    | 'extension_not_installed'
    | 'extension_bridge_offline'
    | 'extension_not_connected'
    | 'local_chromium_missing'
    | 'cloakbrowser_not_installed'
    | 'cdp_unreachable'
    | 'cloud_api_key_missing';
  deepLink: string;
  detail?: string;
  message?: string;
};

const VALID_BACKENDS: ReadonlySet<BrowserSetupRequiredPayload['backend']> = new Set([
  'extension',
  'local',
  'cloakbrowser',
  'cdp',
  'cloud',
]);

const VALID_REASONS: ReadonlySet<BrowserSetupRequiredPayload['reason']> = new Set([
  'extension_not_installed',
  'extension_bridge_offline',
  'extension_not_connected',
  'local_chromium_missing',
  'cloakbrowser_not_installed',
  'cdp_unreachable',
  'cloud_api_key_missing',
]);

/** Detect + decode the JSON sentinel `browser_use` emits when the backend isn't ready. */
export function parseBrowserSetupRequired(resultText: string | undefined): BrowserSetupRequiredPayload | null {
  if (!resultText?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const rec = parsed as Record<string, unknown>;
  if (rec.kind !== 'browser_setup_required') return null;

  const backend = rec.backend;
  const reason = rec.reason;
  const deepLink = rec.deepLink;
  if (typeof backend !== 'string' || !VALID_BACKENDS.has(backend as never)) return null;
  if (typeof reason !== 'string' || !VALID_REASONS.has(reason as never)) return null;
  if (typeof deepLink !== 'string' || !deepLink.startsWith('/settings/')) return null;

  return {
    kind: 'browser_setup_required',
    backend: backend as BrowserSetupRequiredPayload['backend'],
    reason: reason as BrowserSetupRequiredPayload['reason'],
    deepLink,
    detail: typeof rec.detail === 'string' ? rec.detail : undefined,
    message: typeof rec.message === 'string' ? rec.message : undefined,
  };
}
