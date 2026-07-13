import type { ExtensionApiRow } from './types';

/** Loaded in the gateway process (tools/hooks) or marked to load after restart. */
function extensionUiUnlocked(e: ExtensionApiRow): boolean {
  return e.active || e.activationEligible === true;
}

/** Manifest declares iframe surfaces (served from disk). */
function manifestDeclaresGatewayContributions(e: ExtensionApiRow): boolean {
  const c = e.ui?.contributions;
  if (!c) return false;
  return (
    (Array.isArray(c.pages) && c.pages.length > 0) ||
    (Array.isArray(c.settingsPanels) && c.settingsPanels.length > 0) ||
    (Array.isArray(c.chatWidgets) && c.chatWidgets.length > 0) ||
    (Array.isArray(c.sidebarPanels) && c.sidebarPanels.length > 0)
  );
}

/**
 * Built-in extensions ship UI assets with the gateway; `/api/extensions/:id/assets/*` does not
 * require the Node runtime to be activated. Used for Extensions detail + `/extensions/...` routes only —
 * not for sidebar/command palette ({@link useUiExtensions} stays gated on activation).
 */
function extensionBundledUiBrowsable(e: ExtensionApiRow): boolean {
  return e.source === 'bundled' && e.hasUi === true && manifestDeclaresGatewayContributions(e);
}

/** Credential-only settings pages (no manifest configSchema). */
export function extensionHasProviderCredentialsSettings(e: ExtensionApiRow): boolean {
  return e.kind === 'image-generation' || e.kind === 'media-provider';
}

/** Used by sidebar nav, command palette, and {@link useUiExtensions} (active or pending activation only). */
export function extensionExposesGatewayShellUi(e: ExtensionApiRow): boolean {
  if (!extensionUiUnlocked(e)) return false;
  if (e.hasConfigSchema) return true;
  if (extensionHasProviderCredentialsSettings(e)) return true;
  if (!e.hasUi) return false;
  return manifestDeclaresGatewayContributions(e);
}

/** Extension UI reachable from Extensions page or `/extensions/:id` (includes bundled static UI when off). */
export function extensionShellUiReachable(e: ExtensionApiRow): boolean {
  return extensionExposesGatewayShellUi(e) || extensionBundledUiBrowsable(e);
}
