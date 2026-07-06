type ViewManagerResolver = (name: string) => unknown;

export interface DomEditorAvailabilityInput {
  platform: string;
  isStoreClient?: boolean;
  hasExpoDomWebViewModule?: boolean;
  getViewManagerConfig?: ViewManagerResolver;
}

export function canUseDomEditor({
  platform,
  isStoreClient,
  hasExpoDomWebViewModule,
  getViewManagerConfig,
}: DomEditorAvailabilityInput): boolean {
  if (platform === 'web') return true;
  if (isStoreClient) return false;
  if (hasExpoDomWebViewModule) return true;
  if (!getViewManagerConfig) return false;

  try {
    return Boolean(
      getViewManagerConfig('ViewManagerAdapter_ExpoDomWebViewModule')
        || getViewManagerConfig('RCTViewManagerAdapter_ExpoDomWebViewModule'),
    );
  } catch {
    return false;
  }
}
