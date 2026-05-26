/**
 * Tab definitions for the Models & credentials hub. Mirrors the tabbed
 * pattern in `/settings/agent-defaults` — a flat horizontal strip drives
 * a single visible panel below it, with `?tab=<id>` deep-linkable.
 *
 * Each tab id matches an old top-level settings route id so the redirect
 * map in `pages/settings-page.tsx` can land users on the right tab when
 * they hit a legacy URL.
 */

export type ModelsHubTabId =
  | 'providers'
  | 'models'
  | 'image-models'
  | 'voice'
  | 'search';

export const MODELS_HUB_TABS: readonly ModelsHubTabId[] = [
  'providers',
  'models',
  'image-models',
  'voice',
  'search',
] as const;

export function parseModelsHubTab(raw: string | null | undefined): ModelsHubTabId {
  const id = (raw ?? '').trim();
  if ((MODELS_HUB_TABS as readonly string[]).includes(id)) {
    return id as ModelsHubTabId;
  }
  return 'providers';
}

/**
 * Map credential snapshot domain ids to hub tabs. The credentials hub state
 * was originally driven by `/settings/<domain>` routes; under the M3.4 Shape
 * C consolidation the snapshot pills jump within the hub instead.
 */
export function modelsHubTabForCredentialDomain(
  domain: 'llm' | 'webSearch' | 'image' | 'voice',
): ModelsHubTabId {
  switch (domain) {
    case 'llm':
      return 'providers';
    case 'webSearch':
      return 'search';
    case 'image':
      return 'image-models';
    case 'voice':
      return 'voice';
  }
}
