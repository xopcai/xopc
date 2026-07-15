type ViewManagerResolver = (name: string) => unknown;

export interface DomEditorAvailabilityInput {
  isStoreClient?: boolean;
  hasExpoDomWebViewModule?: boolean;
  getViewManagerConfig?: ViewManagerResolver;
}

export function canUseDomEditor({
  isStoreClient,
  hasExpoDomWebViewModule,
  getViewManagerConfig,
}: DomEditorAvailabilityInput): boolean {
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
