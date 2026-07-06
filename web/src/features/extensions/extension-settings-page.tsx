/**
 * Extension settings: auto-generated config form (configSchema) + optional iframe (settingsPanels).
 *
 * Routes: /settings/ext/:extensionId, /settings/ext/:extensionId/:panelId
 */

import { Link, useParams } from 'react-router-dom';

import { ExtensionImageProviderSettings } from '@/features/settings/extension-image-provider-settings';
import { ExtensionSttProviderSettings } from '@/features/settings/extension-stt-provider-settings';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { ExtensionAutoSettings } from './extension-auto-settings';
import { ExtensionIframeHost } from './extension-iframe-host';
import { useExtensions } from './extension-provider';

export function ExtensionSettingsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const xm = m.extensionImageGen;
  const xs = m.extensionSttMedia;
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
  const hasAutoForm = Boolean(extension.hasConfigSchema);
  const isImageGeneration = extension.kind === 'image-generation';
  const isMediaProvider = extension.kind === 'media-provider';
  const hasProviderCredentialsUi = isImageGeneration || isMediaProvider;

  if (!hasAutoForm && !hasIframe && !hasProviderCredentialsUi) {
    return (
      <SettingsPanelNotFound
        message={`Extension "${extensionId}" has no settings panels or config schema.`}
      />
    );
  }

  const title = panel?.title ?? `${extension.name} Settings`;

  return (
    <div className="flex w-full flex-col gap-3 px-3 py-8 sm:px-5 xl:px-6">
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      {isImageGeneration ? (
        <div className="flex flex-col gap-2 rounded-lg border border-edge-subtle bg-surface-base px-4 py-3 text-sm">
          <p className="leading-relaxed text-fg-muted">{xm.banner}</p>
          <Link
            to="/settings/credentials?tab=image-models"
            className="w-fit font-medium text-accent hover:underline"
            title={m.imageModelsSettings.imageModelsLinkTitle}
          >
            {xm.openImageModels}
          </Link>
        </div>
      ) : null}
      {isImageGeneration ? <ExtensionImageProviderSettings extensionId={extensionId} /> : null}
      {isMediaProvider ? (
        <div className="flex flex-col gap-2 rounded-lg border border-edge-subtle bg-surface-base px-4 py-3 text-sm">
          <p className="leading-relaxed text-fg-muted">{xs.banner}</p>
          <Link to="/settings/credentials?tab=voice" className="w-fit font-medium text-accent hover:underline">
            {xs.openVoice}
          </Link>
        </div>
      ) : null}
      {isMediaProvider ? <ExtensionSttProviderSettings extensionId={extensionId} /> : null}
      {hasAutoForm ? <ExtensionAutoSettings extensionId={extensionId} /> : null}
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
    <div className="flex w-full flex-col gap-3 px-3 py-8 sm:px-5 xl:px-6">
      <p className="text-sm text-fg-muted">{message}</p>
    </div>
  );
}
