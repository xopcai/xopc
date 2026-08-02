import type { LocalApp } from './api';

export function localAppOpenRoute(
  app: Pick<LocalApp, 'id' | 'extensionId' | 'installationState' | 'enabled' | 'status'>,
): string {
  if (app.installationState === 'installed' && app.enabled && app.status === 'installed') {
    return `/extensions/${encodeURIComponent(app.extensionId)}`;
  }
  return `/local-apps/${encodeURIComponent(app.id)}`;
}
