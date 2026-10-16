import type { ModelSetupUse } from '@xopcai/gateway-contract';
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

import { CapabilityConnectionContext } from './capability-settings-link';
import { CapabilityServiceConnections } from './capability-service-connections';
import { capabilityGroups, capabilityLabels, modelCapabilityPath, parseCapabilityUse, withCapabilityReturnContext } from './capability-navigation';
import { MediaServiceConnections } from './media-service-connections';
import { openCapabilitySettings } from './open-capability-settings';
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

export function CapabilitiesSettingsPanel({ inlineUse, inlineView = 'settings', onViewChange, onPendingChange }: { inlineUse?: ModelSetupUse; inlineView?: 'settings' | 'services'; onViewChange?: (view: 'settings' | 'services') => void; onPendingChange?: (pending: boolean) => void } = {}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const c = m.capabilitiesSettings;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const chatReturnPath = returnTo?.startsWith('/chat/') ? returnTo : null;
  const { capability: routeCapability } = useParams<{ capability: string }>();
  const capability = inlineUse ? 'models' : routeCapability;

  const setupUse = inlineUse ?? parseCapabilityUse(searchParams.get('use'));
  const services = !inlineUse && searchParams.get('view') === 'services';
  const voiceServiceUse = setupUse && ['transcription', 'speech', 'conversation'].includes(setupUse) ? setupUse : undefined;
  const voiceOverview = capability === 'voice' && !searchParams.has('voiceTab');
  const fromVoice = searchParams.get('from') === 'voice';
  const capabilityPath = (use?: typeof setupUse, services = false) => withCapabilityReturnContext(modelCapabilityPath(use, services), searchParams);
  const returnUse = services || capability === 'voice' ? setupUse : undefined;
  const zh = language === 'zh';
  const [connectionUse, setConnectionUse] = useState<ModelSetupUse>();
  const [connectionSaved, setConnectionSaved] = useState<ModelSetupUse>();
  const [connectionEditing, setConnectionEditing] = useState(false);
  const [connectionPending, setConnectionPending] = useState(false);
  const openConnection = (use: ModelSetupUse) => {
    if (settingsPending) return;
    if (!setupUse) { openCapabilitySettings(use, 'services'); return; }
    onViewChange?.('services'); setConnectionUse(use); setConnectionSaved(undefined);
  };
  const openServices = () => setupUse ? openConnection(setupUse) : navigate(capabilityPath(undefined, true));
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const viewKey = `${capability}:${setupUse ?? 'overview'}:${services}:${searchParams.get('voiceTab') ?? ''}`;
  useLayoutEffect(() => {
    if (inlineUse) return;
    const page = pageRef.current;
    let scroller = page?.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const target = scroller ?? document.scrollingElement;
    if (!target) return;
    target.scrollTop = scrollPositions.current.get(viewKey) ?? 0;
    return () => { scrollPositions.current.set(viewKey, target.scrollTop); };
  }, [viewKey, inlineUse]);
  const [modelPending, setModelPending] = useState(false);
  const [voicePending, setVoicePending] = useState(false);
  const settingsPending = modelPending || voicePending || connectionPending;
  useEffect(() => { onPendingChange?.(settingsPending); return () => onPendingChange?.(false); }, [settingsPending, onPendingChange]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [manageTarget, setManageTarget] = useState<{ providerId: string; isCustom: boolean } | null>(null);
  const providerData = useConnectedProviders();
  const xopcCloudConfigured = providerData.cards.some(
    (provider) => provider.id === 'xopc-cloud' && !provider.isCustom,
  );

  useEffect(() => {
    if (inlineUse || capability !== 'models' || searchParams.get('add') !== '1') return;
    setAddDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    setSearchParams(next, { replace: true });
  }, [capability, inlineUse, searchParams, setSearchParams]);

  const handleSaved = useCallback(() => {
    void revalidateModelsHubCaches();
  }, []);

  if (!isCapabilitySettingsSection(capability)) {
    return <Navigate to={capabilitySettingsPath('models')} replace />;
  }

  if (voiceOverview && setupUse) return <Navigate to={withCapabilityReturnContext(modelCapabilityPath(setupUse, false, 'voice'), searchParams)} replace />;

  if (capability === 'image') return <Navigate to={capabilityPath('image')} replace />;

  const renderCapabilitySettings = (use: ModelSetupUse) => <CapabilityConnectionContext.Provider value={openConnection}><div className="min-w-0 space-y-4">
    {connectionSaved === use && (!inlineUse || inlineView === 'settings') ? <p role="status" className="text-sm text-fg-muted">{zh ? '服务设置已保存' : 'Service settings saved'}</p> : null}
    {(inlineUse || connectionUse === use) ? <fieldset hidden={Boolean(inlineUse && inlineView !== 'services')} disabled={connectionPending} className="min-w-0 space-y-3" aria-label={zh ? `接入 ${capabilityLabels[use][0]}` : `Connect ${capabilityLabels[use][1]}`}>
      <div className="flex items-center justify-between">{!inlineUse ? <Button variant="ghost" disabled={connectionPending} onClick={() => setConnectionUse(undefined)}>{zh ? '收起连接' : 'Collapse connection'}</Button> : null}</div>
      <CapabilityServiceConnections key={use} inline onEditingChange={setConnectionEditing} use={use} data={providerData} language={language} labels={c.addProviderDialog} onPendingChange={setConnectionPending} onSaved={() => { handleSaved(); setConnectionUse(undefined); onViewChange?.('settings'); setConnectionSaved(use); }} />
      {use === 'transcription' || use === 'speech' ? <div hidden={connectionEditing}><MediaServiceConnections key={`inline-${use}`} kind={use === 'transcription' ? 'stt' : 'tts'} modelServiceIds={providerData.builtinRows.map(row => row.id)} zh={zh} onPendingChange={setConnectionPending} onSaved={() => { handleSaved(); setConnectionUse(undefined); onViewChange?.('settings'); setConnectionSaved(use); }} /></div> : null}
      {use === 'image' ? <ImageModelsSettingsPanel connectOnly onPendingChange={setConnectionPending} onConnected={() => { handleSaved(); setConnectionUse(undefined); onViewChange?.('settings'); setConnectionSaved(use); }} /> : null}
    </fieldset> : null}
    <div hidden={Boolean(inlineUse && inlineView === 'services')} className="space-y-4">
    {['transcription', 'speech', 'conversation'].includes(use) ? <VoiceSettingsPanel key={use} capability={use as 'transcription' | 'speech' | 'conversation'} onPendingChange={setVoicePending} disabled={modelPending || connectionPending} /> : null}
    {use === 'chat' || use === 'vision' || use === 'image' ? <ModelExecutionSettings capability={use} zh={zh} disabled={modelPending || connectionPending} onPendingChange={setVoicePending} /> : null}
    {use === 'background' ? <p className="text-sm text-fg-muted">{zh ? '仅可选择支持无人值守调用的来源。仅限交互的 Token Plan 不用于后台任务，也不会自动回退到其他计费服务。' : 'Only unattended-capable sources are eligible. No automatic cross-service billing fallback.'}</p> : null}
    </div>
  </div></CapabilityConnectionContext.Provider>;

  const pageTitle = capability === 'voice'
    ? m.nav.settingsVoice
    : capability === 'search'
      ? m.nav.settingsSearch
      : services ? (setupUse ? `${zh ? '接入服务 · ' : 'Connect service · '}${capabilityLabels[setupUse][zh ? 0 : 1]}` : (zh ? '连接的服务' : 'Connected services')) : setupUse ? capabilityLabels[setupUse][zh ? 0 : 1] : (zh ? '模型与能力' : 'Models and capabilities');

  if (inlineUse) return <div className="min-w-0 space-y-4">
    <div hidden={inlineView === 'services'}><ModelUsesList data={providerData} zh={zh} onlyUse={inlineUse} disabled={voicePending || connectionPending} onPendingChange={setModelPending} onChange={openConnection} /></div>

    {renderCapabilitySettings(inlineUse)}
  </div>;

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
        {capability === 'models' && !services ? <Button variant="secondary" disabled={settingsPending} onClick={openServices}>{setupUse ? (zh ? '连接或管理服务' : 'Connect or manage services') : (zh ? '服务账户' : 'Service accounts')}</Button> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {capability === 'models' ? (
          <>
            {services ? <>
              {setupUse ? <p role="status" className="text-sm text-fg-muted">{zh ? '连接后返回原能力选择模型；其他用途保持当前设置。' : 'Return to the capability after connecting to select a model.'}</p> : null}
              {setupUse ? <Link className="text-sm text-accent-fg hover:underline" to={capabilityPath(undefined, true)}>{zh ? '管理全部服务' : 'Manage all services'}</Link> : <section className="space-y-3 rounded-xl border border-edge p-4">
                <h2 className="text-sm font-semibold text-fg">{zh ? '按能力接入服务' : 'Connect by capability'}</h2>
                <p className="text-sm text-fg-muted">{zh ? '选择能力，在弹窗中连接服务、切换模型或调整参数，关闭后继续管理服务。' : 'Choose a capability to connect services, switch models or adjust parameters in a dialog, then continue here.'}</p>
                <div className="grid gap-2 sm:grid-cols-2">{capabilityGroups.flatMap(group => group.uses).map(use => <button key={use} type="button" aria-haspopup="dialog" disabled={settingsPending} className="min-h-11 rounded-lg border border-edge p-3 text-left text-sm text-accent-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50" onClick={() => openConnection(use)}>{capabilityLabels[use][zh ? 0 : 1]}</button>)}</div>
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
              <ModelUsesList returnTo={chatReturnPath ?? undefined} data={providerData} zh={zh} onlyUse={setupUse} disabled={voicePending || connectionPending} onPendingChange={setModelPending}
                onChange={openConnection}
                onSettings={setupUse ? undefined : use => { if (!settingsPending) openCapabilitySettings(use); }} />
              {setupUse ? renderCapabilitySettings(setupUse) : null}
            </>}
          </>
        ) : voiceOverview ? <>
          <ModelUsesList returnTo={chatReturnPath ?? undefined} data={providerData} zh={zh} voiceOverview disabled={voicePending || connectionPending} onPendingChange={setModelPending} onChange={openConnection} onSettings={use => { if (!settingsPending) openCapabilitySettings(use); }} />
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
