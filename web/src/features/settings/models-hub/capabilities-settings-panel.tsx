import type { ModelSetupUse } from '@xopcai/gateway-contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ImageModelsSettingsPanel } from '@/features/settings/image-models-settings';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { VoiceSettingsPanel } from '@/features/settings/voice-settings';
import { WebSearchSettingsPanel } from '@/features/settings/web-search-settings';
import { messages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

import { CapabilityConnectionContext } from './capability-settings-link';
import { CapabilityServiceConnections } from './capability-service-connections';
import { capabilityReturnPath, parseCapabilityUse } from './capability-navigation';
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

export function CapabilitiesSettingsPanel({ inlineUse, inlineView = 'settings', onViewChange, onPendingChange }: { inlineUse?: ModelSetupUse; inlineView?: 'settings' | 'services'; onViewChange?: (view: 'settings' | 'services') => void; onPendingChange?: (pending: boolean) => void } = {}) {
  const language = useLocaleStore(state => state.language);
  const zh = language === 'zh';
  const c = messages(language).capabilitiesSettings;
  const { capability } = useParams<{ capability: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state: locationState } = useLocation();
  const returnTo = capabilityReturnPath(searchParams.get('returnTo'));
  const [connectionSaved, setConnectionSaved] = useState<ModelSetupUse>();
  const [connectionEditing, setConnectionEditing] = useState(false);
  const [connectionPending, setConnectionPending] = useState(false);
  const [modelPending, setModelPending] = useState(false);
  const [voicePending, setVoicePending] = useState(false);
  const settingsPending = modelPending || voicePending || connectionPending;
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [manageTarget, setManageTarget] = useState<{ providerId: string; isCustom: boolean } | null>(null);
  const servicesRef = useRef<HTMLElement>(null);
  const providerData = useConnectedProviders();
  const hasCloudAccount = providerData.cards.some(row => row.id === 'xopc-cloud' && !row.isCustom);
  const handleSaved = useCallback(() => { void revalidateModelsHubCaches(); }, []);
  useEffect(() => { onPendingChange?.(settingsPending); return () => onPendingChange?.(false); }, [settingsPending, onPendingChange]);
  useEffect(() => {
    if (inlineUse || capability !== 'models') return;
    const use = parseCapabilityUse(searchParams.get('configure'));
    if (!use && searchParams.get('add') !== '1') return;
    // Dispatch after the shared modal host has mounted, including direct links.
    const timer = window.setTimeout(() => {
      if (use) openCapabilitySettings(use, searchParams.get('tab') === 'services' ? 'services' : 'settings');
      else setAddDialogOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('configure'); next.delete('tab'); next.delete('add');
      setSearchParams(next, { replace: true, state: locationState });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [capability, inlineUse, searchParams, setSearchParams, locationState]);
  const openConnection = (use: ModelSetupUse) => {
    if (settingsPending) return;
    if (!inlineUse) { openCapabilitySettings(use, 'services'); return; }
    onViewChange?.('services'); setConnectionSaved(undefined);
  };
  const connected = (use: ModelSetupUse) => { handleSaved(); onViewChange?.('settings'); setConnectionSaved(use); };

  if (inlineUse) return <div className="min-w-0 space-y-4">
    <div hidden={inlineView === 'services'}><ModelUsesList data={providerData} zh={zh} onlyUse={inlineUse} disabled={voicePending || connectionPending} onPendingChange={setModelPending} onChange={openConnection} /></div>
    <CapabilityConnectionContext.Provider value={openConnection}>
      {connectionSaved === inlineUse && inlineView === 'settings' ? <p role="status" className="text-sm text-fg-muted">{zh ? '服务设置已保存' : 'Service settings saved'}</p> : null}
      <fieldset hidden={inlineView !== 'services'} disabled={connectionPending} className="min-w-0 space-y-3">
        <CapabilityServiceConnections key={inlineUse} inline onEditingChange={setConnectionEditing} use={inlineUse} data={providerData} language={language} labels={c.addProviderDialog} onPendingChange={setConnectionPending} onSaved={() => connected(inlineUse)} />
        {inlineUse === 'transcription' || inlineUse === 'speech' ? <div hidden={connectionEditing}><MediaServiceConnections key={inlineUse} kind={inlineUse === 'transcription' ? 'stt' : 'tts'} modelServiceIds={providerData.builtinRows.map(row => row.id)} zh={zh} onPendingChange={setConnectionPending} onSaved={() => connected(inlineUse)} /></div> : null}
        {inlineUse === 'image' ? <ImageModelsSettingsPanel connectOnly onPendingChange={setConnectionPending} onConnected={() => connected(inlineUse)} /> : null}
      </fieldset>
      <div hidden={inlineView === 'services'} className="space-y-4">
        {inlineUse === 'transcription' || inlineUse === 'speech' || inlineUse === 'conversation' ? <VoiceSettingsPanel key={inlineUse} capability={inlineUse} onPendingChange={setVoicePending} disabled={modelPending || connectionPending} /> : null}
        {inlineUse === 'chat' || inlineUse === 'vision' || inlineUse === 'image' ? <ModelExecutionSettings capability={inlineUse} zh={zh} disabled={modelPending || connectionPending} onPendingChange={setVoicePending} /> : null}
        {inlineUse === 'background' ? <p className="text-sm text-fg-muted">{zh ? '使用所选模型执行自动化、定时和无人值守任务。此设置不会启用任务，也不会自动改用其他计费服务。' : 'Use the selected model for automations, schedules and unattended tasks. This does not enable tasks or automatically switch billing services.'}</p> : null}
      </div>
    </CapabilityConnectionContext.Provider>
  </div>;
  if (capability === 'search') return <SettingsPageFrame><SettingsPageHeader title={messages(language).nav.settingsSearch} /><WebSearchSettingsPanel /></SettingsPageFrame>;
  if (capability !== 'models') return <Navigate to="/settings/capabilities/models" replace />;
  return <SettingsPageFrame>
    <SettingsPageHeader title={zh ? '模型与能力' : 'Models and capabilities'} subtitle={zh ? '按用途选择模型，在设置中调整参数与服务连接。' : 'Choose models by purpose. Adjust parameters and connections in settings.'} actions={<div className="flex items-center gap-2"><a href={docsGuidePageUrl(language, 'configuration')} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{c.docsLink}</a><Button variant="secondary" disabled={settingsPending} onClick={() => { servicesRef.current?.scrollIntoView?.({ block: 'start' }); servicesRef.current?.focus({ preventScroll: true }); }}>{zh ? '服务账户' : 'Service accounts'}</Button></div>} />
    {returnTo ? <Link to={returnTo} className="text-sm text-accent-fg hover:underline">{returnTo === '/settings/phone-use' ? (zh ? '返回手机控制并测试模型' : 'Return to phone control and test the model') : (zh ? '返回原来的工作' : 'Return to your work')}</Link> : null}
    {returnTo ? <p className="text-sm text-fg-muted">{returnTo === '/settings/phone-use' ? (zh ? '正在为手机控制连接模型服务；此处保存服务设置后，还需返回选择并测试手机模型。' : 'Connect a model service for phone control, then return to select and test the phone model.') : (zh ? '正在为原来的工作配置模型。服务保存、模型选择和实际运行验证分别生效。' : 'Configure models for your work. Saving a service, choosing a model and verifying a run are separate steps.')}</p> : null}
    <ModelUsesList data={providerData} zh={zh} disabled={settingsPending} onPendingChange={setModelPending} onChange={openConnection} onSettings={use => { if (!settingsPending) openCapabilitySettings(use); }} />
    <section ref={servicesRef} tabIndex={-1} aria-labelledby="model-services-heading" className="space-y-4 scroll-mt-4 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <div><h2 id="model-services-heading" className="text-base font-semibold text-fg">{zh ? '连接的服务' : 'Connected services'}</h2><p className="mt-1 text-sm text-fg-muted">{zh ? '在这里管理账户和密钥；各项能力的模型与参数在上方调整。' : 'Manage accounts and keys here. Choose models and adjust capability settings above.'}</p></div>
      {hasCloudAccount ? <XopcCloudAccountCard labels={c.xopcCloudAccount}><ModelCatalogStatus showCapabilities={false} embedded /></XopcCloudAccountCard> : null}
      <ConnectedProvidersGrid labels={c.connectedProviders} data={providerData} onAdd={() => setAddDialogOpen(true)} onManage={(providerId, isCustom) => setManageTarget({ providerId, isCustom })} />
      {!hasCloudAccount && providerData.cards.length > 0 ? <ModelCatalogStatus showCapabilities={false} /> : null}
    </section>
    <AddProviderDialog open={addDialogOpen} connectOnly onOpenChange={setAddDialogOpen} builtinRows={providerData.builtinRows} customConfig={providerData.customConfig} labels={c.addProviderDialog} language={language} onSaved={() => { handleSaved(); setAddDialogOpen(false); }} />
    {manageTarget ? <ProviderManageDialog open onOpenChange={open => { if (!open) setManageTarget(null); }} providerId={manageTarget.providerId} isCustom={manageTarget.isCustom} builtinRows={providerData.builtinRows} customConfig={providerData.customConfig} allModels={providerData.allModels} labels={c.manageProviderDialog} language={language} onSaved={handleSaved} /> : null}
  </SettingsPageFrame>;
}
