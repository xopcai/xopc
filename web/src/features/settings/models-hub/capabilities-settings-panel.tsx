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

import { CapabilityServiceConnections } from './capability-service-connections';
import { capabilityGroups, capabilityLabels, modelCapabilityPath, parseCapabilityUse, withCapabilityReturnContext } from './capability-navigation';
import { MediaServiceConnections } from './media-service-connections';
import { ModelUsesList } from './model-uses-list';
import { AddProviderDialog } from './add-provider-dialog';
import { ConnectedProvidersGrid, useConnectedProviders } from './connected-providers-grid';
import { revalidateModelsHubCaches } from './models-hub-cache';
import { ProviderManageDialog } from './provider-manage-dialog';
import { ModelExecutionSettings } from './model-execution-settings';
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
  const voiceServiceUse = setupUse && ['transcription', 'speech', 'conversation'].includes(setupUse) ? setupUse : undefined;
  const voiceOverview = capability === 'voice' && !searchParams.has('voiceTab');
  const fromVoice = searchParams.get('from') === 'voice';
  const capabilityPath = (use?: typeof setupUse, services = false) => withCapabilityReturnContext(modelCapabilityPath(use, services), searchParams);
  const returnUse = services || capability === 'voice' ? setupUse : undefined;
  const zh = language === 'zh';
  const openServices = () => navigate(capabilityPath(setupUse, true));
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const viewKey = `${capability}:${setupUse ?? 'overview'}:${services}:${searchParams.get('voiceTab') ?? ''}`;
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
  const settingsPending = modelPending || voicePending;
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

  if (voiceOverview && setupUse) return <Navigate to={withCapabilityReturnContext(modelCapabilityPath(setupUse, false, 'voice'), searchParams)} replace />;

  if (capability === 'image') return <Navigate to={capabilityPath('image')} replace />;

  const pageTitle = capability === 'voice'
    ? m.nav.settingsVoice
    : capability === 'search'
      ? m.nav.settingsSearch
      : services ? (setupUse ? `${zh ? '接入服务 · ' : 'Connect service · '}${capabilityLabels[setupUse][zh ? 0 : 1]}` : (zh ? '连接的服务' : 'Connected services')) : setupUse ? capabilityLabels[setupUse][zh ? 0 : 1] : (zh ? '模型与能力' : 'Models and capabilities');

  return (
    <div ref={pageRef} className="contents"><SettingsPageFrame>
      <SettingsPageHeader
        title={pageTitle}
        docsLink={docsGuidePageUrl(language, 'configuration')}
        docsLabel={c.docsLink}
      />

      {chatReturnPath ? <Link aria-disabled={settingsPending} onClick={event => { if (settingsPending) event.preventDefault(); }} to={chatReturnPath} className="text-sm text-accent-fg hover:underline">{language === 'zh' ? '返回对话' : 'Return to conversation'}</Link> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {capability !== 'models' || setupUse || services ? <Link aria-disabled={settingsPending} onClick={event => { if (settingsPending) event.preventDefault(); }} className="text-sm text-accent-fg hover:underline" to={returnUse ? capabilityPath(returnUse) : fromVoice ? withCapabilityReturnContext('/settings/capabilities/voice', searchParams) : capabilityPath()}>{returnUse ? `${zh ? '返回' : 'Back to '}${capabilityLabels[returnUse][zh ? 0 : 1]}` : fromVoice ? (zh ? '返回语音' : 'Back to voice') : zh ? '返回能力总览' : 'Back to capabilities'}</Link> : <p className="text-sm text-fg-muted">{zh ? '选择需要配置的能力。' : 'Choose a capability to configure.'}</p>}
        {capability === 'models' && !services ? <Button variant="secondary" disabled={voicePending || modelPending} onClick={openServices}>{zh ? '连接的服务' : 'Connected services'}</Button> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {capability === 'models' ? (
          <>
            {services ? <>
              {setupUse ? <p role="status" className="text-sm text-fg-muted">{zh ? '连接后返回原能力选择模型；其他用途保持当前设置。' : 'Return to the capability after connecting to select a model.'}</p> : null}
              {setupUse ? <Link className="text-sm text-accent-fg hover:underline" to={capabilityPath(undefined, true)}>{zh ? '管理全部服务' : 'Manage all services'}</Link> : <section className="space-y-3 rounded-xl border border-edge p-4">
                <h2 className="text-sm font-semibold text-fg">{zh ? '按能力接入服务' : 'Connect by capability'}</h2>
                <p className="text-sm text-fg-muted">{zh ? '先选择用途，再连接支持它的服务。音色、识别语言与图片参数在各能力详情中调整。' : 'Choose a capability to connect a suitable service. Adjust voices, recognition languages and image options in capability details.'}</p>
                <div className="grid gap-2 sm:grid-cols-2">{capabilityGroups.flatMap(group => group.uses).map(use => <Link key={use} className="rounded-lg border border-edge p-3 text-sm text-accent-fg hover:bg-surface-hover" to={capabilityPath(use, true)}>{capabilityLabels[use][zh ? 0 : 1]}</Link>)}</div>
              </section>}
              {voiceServiceUse ? <>
                <CapabilityServiceConnections key={voiceServiceUse} use={voiceServiceUse} data={providerData} language={language} labels={c.addProviderDialog} onSaved={() => { handleSaved(); navigate(capabilityPath(setupUse)); }} />
                {voiceServiceUse !== 'conversation' ? <MediaServiceConnections key={`native-${voiceServiceUse}`} kind={voiceServiceUse === 'transcription' ? 'stt' : 'tts'} modelServiceIds={providerData.builtinRows.map(row => row.id)} zh={zh} onSaved={() => { handleSaved(); navigate(capabilityPath(setupUse)); }} /> : null}
              </> : <>
                {!setupUse && xopcCloudConfigured ? <XopcCloudAccountCard labels={c.xopcCloudAccount} /> : null}
                <ConnectedProvidersGrid labels={c.connectedProviders} data={providerData}
                  onAdd={() => setAddDialogOpen(true)}
                  onManage={(providerId, isCustom) => setManageTarget({ providerId, isCustom })} />
                {setupUse === 'image' ? <ImageModelsSettingsPanel connectOnly onConnected={() => { handleSaved(); navigate(capabilityPath(setupUse)); }} /> : null}
                {providerData.cards.length > 0 ? <ModelCatalogStatus /> : null}
              </>}

            </> : <>
              <ModelUsesList returnTo={chatReturnPath ?? undefined} data={providerData} zh={zh} onlyUse={setupUse} disabled={voicePending} onPendingChange={setModelPending}
                onChange={use => navigate(capabilityPath(use, true))}
                onSettings={setupUse ? undefined : use => navigate(capabilityPath(use))} />
              {setupUse ? <>
                {['transcription', 'speech', 'conversation'].includes(setupUse) ? <VoiceSettingsPanel key={setupUse} capability={setupUse as 'transcription' | 'speech' | 'conversation'} onPendingChange={setVoicePending} disabled={modelPending} /> : null}
                {setupUse === 'image' ? <p className="text-sm text-fg-muted">{zh ? '模型尺寸与格式由当前来源支持的能力决定。自定义来源的默认参数在服务设置中管理。' : 'Sizes and formats depend on the selected source. Manage custom source defaults in service settings.'}</p> : null}
                {setupUse === 'chat' || setupUse === 'vision' || setupUse === 'image' ? <ModelExecutionSettings capability={setupUse} zh={zh} disabled={modelPending} onPendingChange={setVoicePending} /> : null}
                {setupUse === 'background' ? <p className="text-sm text-fg-muted">{zh ? '仅可选择支持无人值守调用的来源。仅限交互的 Token Plan 不用于后台任务，也不会自动回退到其他计费服务。' : 'Only unattended-capable sources are eligible. Interactive Token Plans are excluded; no automatic cross-service billing fallback.'}</p> : null}
              </> : null}
            </>}
          </>
        ) : voiceOverview ? <>
          <ModelUsesList returnTo={chatReturnPath ?? undefined} data={providerData} zh={zh} voiceOverview onChange={use => navigate(modelCapabilityPath(use, true, 'voice', chatReturnPath ?? undefined))} onSettings={use => navigate(modelCapabilityPath(use, false, 'voice', chatReturnPath ?? undefined))} />
          <Link className="w-fit text-sm text-accent-fg hover:underline" to={withCapabilityReturnContext("/settings/capabilities/voice?voiceTab=devices&from=voice", searchParams)}>{zh ? '麦克风、扬声器与设备' : 'Microphone, speakers and devices'}</Link>
        </> : <CapabilitySectionPanel section={capability} onVoicePendingChange={setVoicePending} disabled={modelPending} />}

      </div>

      <AddProviderDialog
        open={addDialogOpen}
        connectOnly
        initialUse={setupUse}
        onOpenChange={setAddDialogOpen}
        builtinRows={providerData.builtinRows}
        customConfig={providerData.customConfig}
        labels={c.addProviderDialog}
        language={language}
        onSaved={() => { handleSaved(); setAddDialogOpen(false); if (setupUse) navigate(capabilityPath(setupUse)); }}
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

function CapabilitySectionPanel({ section, onVoicePendingChange, disabled }: { section: CapabilitySettingsSectionId; onVoicePendingChange: (pending: boolean) => void; disabled: boolean }) {
  switch (section) {
    case 'models':
      return null;
    case 'image':
      return <ImageModelsSettingsPanel />;
    case 'voice':
      return <VoiceSettingsPanel onPendingChange={onVoicePendingChange} disabled={disabled} />;
    case 'search':
      return <WebSearchSettingsPanel />;
  }
}
