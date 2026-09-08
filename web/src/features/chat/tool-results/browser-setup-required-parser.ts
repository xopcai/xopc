/** Discriminated payload emitted by `browser_use` when preflight fails. */
export type BrowserSetupRequiredPayload = {
  kind: 'browser_setup_required';
  driver: 'extension' | 'playwright' | 'cdp' | 'remote';
  reason:
    | 'extension_not_installed'
    | 'extension_not_connected'
    | 'chromium_missing'
    | 'cdp_unreachable'
    | 'remote_api_key_missing';
  deepLink: string;
  detail?: string;
  message?: string;
};

const VALID_DRIVERS: ReadonlySet<BrowserSetupRequiredPayload['driver']> = new Set([
  'extension',
  'playwright',
  'cdp',
  'remote',
]);

const VALID_REASONS: ReadonlySet<BrowserSetupRequiredPayload['reason']> = new Set([
  'extension_not_installed',
  'extension_not_connected',
  'chromium_missing',
  'cdp_unreachable',
  'remote_api_key_missing',
]);

/** Decode only the structured tool details; browser setup is never inferred from display text. */
export function parseBrowserSetupRequired(details: unknown): BrowserSetupRequiredPayload | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const rec = details as Record<string, unknown>;
  if (rec.kind !== 'browser_setup_required') return null;
  const hint = rec.hint && typeof rec.hint === 'object' && !Array.isArray(rec.hint)
    ? rec.hint as Record<string, unknown>
    : null;
  if (!hint) return null;

  const driver = hint.driver;
  const reason = hint.reason;
  const deepLink = hint.deepLink;
  if (typeof driver !== 'string' || !VALID_DRIVERS.has(driver as never)) return null;
  if (typeof reason !== 'string' || !VALID_REASONS.has(reason as never)) return null;
  if (typeof deepLink !== 'string' || !deepLink.startsWith('/settings/')) return null;

  return {
    kind: 'browser_setup_required',
    driver: driver as BrowserSetupRequiredPayload['driver'],
    reason: reason as BrowserSetupRequiredPayload['reason'],
    deepLink,
    detail: typeof hint.detail === 'string' ? hint.detail : undefined,
  };
}
