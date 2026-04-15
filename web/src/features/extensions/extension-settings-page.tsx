/**
 * ExtensionSettingsPage — renders an extension's settings panel via ExtensionIframeHost.
 *
 * Mounted at /settings/ext/:extensionId/:panelId within the settings layout.
 */

import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ExtensionIframeHost } from './extension-iframe-host';
import { useUiExtensions } from './extension-provider';

export function ExtensionSettingsPage() {
  const { t } = useTranslation();
  const { extensionId, panelId } = useParams<{ extensionId: string; panelId?: string }>();
  const uiExtensions = useUiExtensions();

  if (!extensionId) {
    return <SettingsPanelNotFound message="No extension ID provided." />;
  }

  const extension = uiExtensions.find((ext) => ext.id === extensionId);
  if (!extension) {
    return (
      <SettingsPanelNotFound message={`Extension "${extensionId}" not found or has no UI.`} />
    );
  }

  const panels = extension.ui?.contributions?.settingsPanels;
  if (!panels?.length) {
    return (
      <SettingsPanelNotFound message={`Extension "${extensionId}" has no settings panels.`} />
    );
  }

  const panel = panelId
    ? panels.find((p) => p.id === panelId || p.id === `${extensionId}.${panelId}`)
    : panels[0];

  if (!panel) {
    return <SettingsPanelNotFound message={`Settings panel "${panelId}" not found.`} />;
  }

  const pendingRestart =
    !extension.active && extension.activationEligible === true;

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
      <h1 className="text-lg font-semibold text-fg">{panel.title}</h1>
      {pendingRestart ? (
        <p className="rounded-lg border border-edge-subtle bg-surface-hover/50 px-3 py-2 text-xs text-fg-muted">
          {t('appsPage.runStatePendingOn')}
        </p>
      ) : null}
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
