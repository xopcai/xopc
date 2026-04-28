/**
 * Extension settings: auto-generated config form (configSchema) + optional iframe (settingsPanels).
 *
 * Routes: /settings/ext/:extensionId, /settings/ext/:extensionId/:panelId
 */

import { useParams } from 'react-router-dom';

import { ExtensionAutoSettings } from './extension-auto-settings';
import { ExtensionIframeHost } from './extension-iframe-host';
import { useExtensions } from './extension-provider';

export function ExtensionSettingsPage() {
  const { extensionId, panelId } = useParams<{ extensionId: string; panelId?: string }>();
  const extensions = useExtensions();

  if (!extensionId) {
    return <SettingsPanelNotFound message="No extension ID provided." />;
  }

  const extension = extensions.find((ext) => ext.id === extensionId);
  if (!extension) {
    return (
      <SettingsPanelNotFound
        message={`Extension "${extensionId}" not found or is not available in this workspace.`}
      />
    );
  }

  const panels = extension.ui?.contributions?.settingsPanels;
  const panel = panelId
    ? panels?.find((p) => p.id === panelId || p.id === `${extensionId}.${panelId}`)
    : panels?.[0];

  const hasIframe = Boolean(panel && extension.ui);
  const hasAuto = Boolean(extension.hasConfigSchema);

  if (!hasAuto && !hasIframe) {
    return (
      <SettingsPanelNotFound
        message={`Extension "${extensionId}" has no settings panels or config schema.`}
      />
    );
  }

  const title = panel?.title ?? `${extension.name} Settings`;

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <ExtensionAutoSettings extensionId={extensionId} />
      {hasIframe && panel && extension.ui ? (
        <div className="overflow-hidden rounded-xl border border-edge bg-surface-base">
          <ExtensionIframeHost
            extensionId={extensionId}
            extensionName={extension.name}
            entrypoint={panel.entrypoint}
            permissions={extension.ui?.permissions}
            title={panel.title}
            className="w-full"
            minHeight={120}
            maxHeight={2000}
          />
        </div>
      ) : null}
    </div>
  );
}

function SettingsPanelNotFound({ message }: { message: string }) {
  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
      <p className="text-sm text-fg-muted">{message}</p>
    </div>
  );
}
