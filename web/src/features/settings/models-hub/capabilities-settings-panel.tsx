import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ImageModelsSettingsPanel } from '@/features/settings/image-models-settings';
import {
  SettingsPageFrame,
  SettingsPageHeader,
} from '@/features/settings/settings-page-layout';
import { VoiceSettingsPanel } from '@/features/settings/voice-settings';
import { WebSearchSettingsPanel } from '@/features/settings/web-search-settings';
import { messages } from '@/i18n/messages';
import {
  CAPABILITY_SETTINGS_SECTIONS,
  capabilitySettingsPath,
  docsGuidePageUrl,
  type CapabilitySettingsSectionId,
} from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

import { capabilityLabels, modelCapabilityPath, parseCapabilityUse } from './capability-navigation';
import { MediaServiceConnections } from './media-service-connections';
import { ModelUsesList } from './model-uses-list';
import { AddProviderDialog } from './add-provider-dialog';
import { ConnectedProvidersGrid, useConnectedProviders } from './connected-providers-grid';
import { revalidateModelsHubCaches } from './models-hub-cache';
import { ProviderManageDialog } from './provider-manage-dialog';
import { ModelCatalogStatus } from './model-catalog-status';
import { XopcCloudAccountCard } from './xopc-cloud-account-card';

function isCapabilitySettingsSection(value: string | undefined): value is CapabilitySettingsSectionId {
  return CAPABILITY_SETTINGS_SECTIONS.includes(value as CapabilitySettingsSectionId);
}

export function CapabilitiesSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const c = m.capabilitiesSettings;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const chatReturnPath = returnTo?.startsWith('/chat/') ? returnTo : null;
  const { capability } = useParams<{ capability: string }>();

  const setupUse = parseCapabilityUse(searchParams.get('use'));
  const services = searchParams.get('view') === 'services';
  const returnUse = services || capability === 'voice' ? setupUse : undefined;
  const zh = language === 'zh';
  const openServices = () => navigate(modelCapabilityPath(setupUse, true));
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const viewKey = `${capability}:${setupUse ?? 'overview'}:${services}`;
  useLayoutEffect(() => {
    const page = pageRef.current;
    let scroller = page?.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const target = scroller ?? document.scrollingElement;
    if (!target) return;
    target.scrollTop = scrollPositions.current.get(viewKey) ?? 0;
    return () => { scrollPositions.current.set(viewKey, target.scrollTop); };
  }, [viewKey]);
  const [modelPending, setModelPending] = useState(false);
  const [voicePending, setVoicePending] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [manageTarget, setManageTarget] = useState<{ providerId: string; isCustom: boolean } | null>(null);
  const providerData = useConnectedProviders();
  const xopcCloudConfigured = providerData.cards.some(
    (provider) => provider.id === 'xopc-cloud' && !provider.isCustom,
  );

  useEffect(() => {
    if (capability !== 'models' || searchParams.get('add') !== '1') return;
    setAddDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    setSearchParams(next, { replace: true });
  }, [capability, searchParams, setSearchParams]);

  const handleSaved = useCallback(() => {
    void revalidateModelsHubCaches();
  }, []);

  if (!isCapabilitySettingsSection(capability)) {
    return <Navigate to={capabilitySettingsPath('models')} replace />;
  }

  if (capability === 'image') return <Navigate to={modelCapabilityPath('image')} replace />;

  const pageTitle = capability === 'voice'
    ? m.nav.settingsVoice
    : capability === 'search'
      ? m.nav.settingsSearch
      : services ? (zh ? '连接的服务' : 'Connected services') : setupUse ? capabilityLabels[setupUse][zh ? 0 : 1] : (zh ? '模型与能力' : 'Models and capabilities');

  return (
    <div ref={pageRef} className="contents"><SettingsPageFrame>
      <SettingsPageHeader
        title={pageTitle}
        docsLink={docsGuidePageUrl(language, 'configuration')}
        docsLabel={c.docsLink}
      />

      {capability === 'voice' && chatReturnPath ? <Link to={chatReturnPath} className="text-sm text-accent-fg hover:underline">{language === 'zh' ? '返回对话' : 'Return to conversation'}</Link> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {capability !== 'models' || setupUse || services ? <Link aria-disabled={modelPending} onClick={event => { if (modelPending) event.preventDefault(); }} className="text-sm text-accent-fg hover:underline" to={returnUse ? modelCapabilityPath(returnUse) : modelCapabilityPath()}>{returnUse ? `${zh ? '返回' : 'Back to '}${capabilityLabels[returnUse][zh ? 0 : 1]}` : zh ? '返回能力总览' : 'Back to capabilities'}</Link> : <p className="text-sm text-fg-muted">{zh ? '先选择需要的能力，再连接服务和调整参数。' : 'Choose a capability, connect a service, and adjust its settings.'}</p>}
        {capability === 'models' && !services ? <Button variant="secondary" disabled={voicePending || modelPending} onClick={openServices}>{zh ? '连接的服务' : 'Connected services'}</Button> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {capability === 'models' ? (
          <>
            {services ? <>
              {setupUse ? <p role="status" className="text-sm text-fg-muted">{zh ? '连接后返回原能力选择模型；其他用途保持当前设置。' : 'Return to the capability after connecting to select a model.'}</p> : null}
              {xopcCloudConfigured ? <XopcCloudAccountCard labels={c.xopcCloudAccount} /> : null}
              <ConnectedProvidersGrid labels={c.connectedProviders} data={providerData}
                onAdd={() => setAddDialogOpen(true)}
                onManage={(providerId, isCustom) => setManageTarget({ providerId, isCustom })} />
              <MediaServiceConnections zh={zh} onSaved={() => { handleSaved(); navigate(modelCapabilityPath(setupUse)); }} />
              <ImageModelsSettingsPanel connectOnly onConnected={() => { handleSaved(); navigate(modelCapabilityPath(setupUse)); }} />
              <div className="rounded-xl border border-edge p-4 space-y-2">
                <p className="text-sm text-fg-muted">{zh ? '传统语音 API、本地语音和自定义图片来源保留原有凭据与高级配置。' : 'Existing voice APIs, local speech and custom image sources keep their credentials and advanced settings.'}</p>
                <Link className="mr-4 text-sm text-accent-fg hover:underline" to={`/settings/capabilities/voice?voiceTab=service${setupUse ? `&use=${setupUse}` : ''}`}>{zh ? '语音服务与设备' : 'Voice services and devices'}</Link>

              </div>
              {providerData.cards.length > 0 ? <ModelCatalogStatus /> : null}
            </> : <>
              <ModelUsesList data={providerData} zh={zh} onlyUse={setupUse} disabled={voicePending} onPendingChange={setModelPending}
                onChange={use => navigate(modelCapabilityPath(use, true))}
                onSettings={setupUse ? undefined : use => navigate(modelCapabilityPath(use))} />
              {setupUse ? <>
                <Button variant="secondary" className="w-fit" disabled={voicePending || modelPending} onClick={openServices}>{zh ? '接入其他服务' : 'Connect another service'}</Button>
                {['transcription', 'speech', 'conversation'].includes(setupUse) ? <VoiceSettingsPanel key={setupUse} capability={setupUse as 'transcription' | 'speech' | 'conversation'} onPendingChange={setVoicePending} disabled={modelPending} /> : null}
                {setupUse === 'image' ? <p className="text-sm text-fg-muted">{zh ? '模型尺寸与格式由当前来源支持的能力决定。自定义来源的默认参数在服务设置中管理。' : 'Sizes and formats depend on the selected source. Manage custom source defaults in service settings.'}</p> : null}
                {setupUse === 'chat' ? <Link className="text-sm text-accent-fg hover:underline" to="/settings/agent-defaults">{zh ? '任务模型与智能体默认设置' : 'Task models and agent defaults'}</Link> : null}
                {setupUse === 'background' ? <p className="text-sm text-fg-muted">{zh ? '仅可选择支持无人值守调用的来源。仅限交互的 Token Plan 不用于后台任务，也不会自动回退到其他计费服务。' : 'Only unattended-capable sources are eligible. Interactive Token Plans are excluded; no automatic cross-service billing fallback.'}</p> : null}
              </> : null}
            </>}
          </>
        ) : (
          <CapabilitySectionPanel section={capability} />
        )}
      </div>

      <AddProviderDialog
        open={addDialogOpen}
        connectOnly
        onOpenChange={setAddDialogOpen}
        builtinRows={providerData.builtinRows}
        customConfig={providerData.customConfig}
        labels={c.addProviderDialog}
        language={language}
        onSaved={() => { handleSaved(); setAddDialogOpen(false); if (setupUse) navigate(modelCapabilityPath(setupUse)); }}
      />

      {manageTarget ? (
        <ProviderManageDialog
          open
          onOpenChange={(open) => {
            if (!open) setManageTarget(null);
          }}
          providerId={manageTarget.providerId}
          isCustom={manageTarget.isCustom}
          builtinRows={providerData.builtinRows}
          customConfig={providerData.customConfig}
          allModels={providerData.allModels}
          labels={c.manageProviderDialog}
          language={language}
          onSaved={handleSaved}
        />
      ) : null}
    </SettingsPageFrame></div>
  );
}

function CapabilitySectionPanel({ section }: { section: CapabilitySettingsSectionId }) {
  switch (section) {
    case 'models':
      return null;
    case 'image':
      return <ImageModelsSettingsPanel />;
    case 'voice':
      return <VoiceSettingsPanel />;
    case 'search':
      return <WebSearchSettingsPanel />;
  }
}
