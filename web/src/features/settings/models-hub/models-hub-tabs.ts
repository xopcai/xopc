/** Task-oriented tabs for the Models & Capabilities center. */
export type ModelsHubTabId = 'services' | 'image-models' | 'voice' | 'search';

export const MODELS_HUB_TABS: readonly ModelsHubTabId[] = [
  'services',
  'image-models',
  'voice',
  'search',
] as const;

export function parseModelsHubTab(raw: string | null | undefined): ModelsHubTabId {
  const id = (raw ?? '').trim();
  if (id === 'providers' || id === 'catalog') {
    return 'services';
  }
  if ((MODELS_HUB_TABS as readonly string[]).includes(id)) {
    return id as ModelsHubTabId;
  }
  return 'services';
}
