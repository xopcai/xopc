import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, ChevronLeft, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ModelSetupPreview, ModelSetupRequest, ModelSetupUse } from '@xopcai/gateway-contract';

import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { SecretInput } from '@/components/ui/secret-input';
import { Skeleton } from '@/components/ui/skeleton';
import { patchProviderApiKeys, type ProviderRowModel } from '@/features/settings/providers-api';
import { PROVIDER_ENRICHMENT } from '@/features/settings/provider-enrichment';
import { messages } from '@/i18n/messages';
import { secretInputLabelsFromChannels } from '@/lib/secret-input-labels';
import type { StoredLanguage } from '@/lib/storage';

import { capabilityLabels } from './capability-navigation';
import { serviceDisplayName } from './capability-presentation';
import { OAuthProviderConnect } from './oauth-provider-connect';
import { applyModelSetup, previewModelSetup } from './provider-setup-api';

const labels: Record<ModelSetupUse, [string, string]> = {
  chat: ['对话与任务', 'Chat and tasks'], vision: ['看图', 'Image understanding'],
  image: ['画图', 'Image generation'], background: ['后台任务', 'Background tasks'],
  speech: ['语音合成', 'Speech synthesis'], transcription: ['录音识别', 'Recorded audio recognition'], conversation: ['实时语音对话', 'Realtime conversation'],
};

/** One connection/apply interaction for account providers, API keys and Token Plans. */
export function ProviderSetupPanel({ providerId, row, modelIds, existingConnection = false, targetUse, connectOnly = false, language, alternatives = [], onChooseProvider, onBack, onDone, onApplied, inline = false, onPendingChange }: {
  providerId: string; row?: ProviderRowModel; modelIds?: string[]; existingConnection?: boolean;
  targetUse?: ModelSetupUse; connectOnly?: boolean; inline?: boolean; onPendingChange?: (pending: boolean) => void;
  alternatives?: ProviderRowModel[]; onChooseProvider?: (id: string) => void;
  language: StoredLanguage; onBack?: () => void; onDone: () => void; onApplied?: () => void;
}) {
  const zh = language === 'zh';
  const initialized = useRef(false);
  const [preview, setPreview] = useState<ModelSetupPreview | null>(null);
  const [request, setRequest] = useState<ModelSetupRequest>({ mode: targetUse ? 'replace' : 'fill', modelIds });
  const [apiKey, setApiKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [credentialSaved, setCredentialSaved] = useState(false);
  const [connected, setConnected] = useState(existingConnection || Boolean(row?.configured));
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void previewModelSetup(providerId, { modelIds, ...(connectOnly ? { selected: [] } : {}), ...(targetUse && !connectOnly ? { mode: 'replace', selected: [targetUse] } as const : {}) }).then(data => {
      if (!active) return;
      setPreview(data); setConnected(data.configured);
      if (!initialized.current) {
        initialized.current = true;
        setRequest({ mode: targetUse ? 'replace' : 'fill', modelIds, selected: connectOnly ? [] : data.uses.filter(use => use.selected).map(use => use.id) });
      }
      setError('');
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [providerId, modelIds, targetUse, connectOnly, attempt]);
  useEffect(() => { onPendingChange?.(busy); return () => onPendingChange?.(false); }, [busy, onPendingChange]);
  const handleOAuthConnected = () => {
    setConnected(true);
    setApiKey('');
    setEditingKey(false);
    if (connectOnly) {
      setDone(true);
      onApplied?.();
    } else {
      setAttempt(value => value + 1);
    }
  };
  const selected = request.selected ?? [];
  const changeMode = (mode: 'fill' | 'replace') => {
    setRequest({ ...request, mode, selected: preview?.uses.filter(use => use.recommended && use.choices.length && (mode === 'replace' || use.selected)).map(use => use.id) ?? [] });
  };
  const save = async () => {
    if (!preview || saving.current) return;
    saving.current = true;
    setBusy(true); setError('');
    setCredentialSaved(false);
    let savedCredential = false;
    try {
      if (apiKey.trim()) {
        await patchProviderApiKeys({ [providerId]: apiKey.trim() });
        savedCredential = true; setCredentialSaved(true); setConnected(true); setEditingKey(false); setApiKey('');
      }
      const fresh = await previewModelSetup(providerId, request);
      setConnected(fresh.configured);
      if (connectOnly) {
        if (!fresh.configured) throw new Error(zh ? '请先连接此服务。' : 'Connect this service first.');
        setPreview(fresh); setDone(true); onApplied?.(); return;
      }
      const before = preview.uses.filter(use => selected.includes(use.id)).map(use => request.overrides?.[use.id] ?? use.recommended);
      const after = fresh.uses.filter(use => selected.includes(use.id)).map(use => request.overrides?.[use.id] ?? use.recommended);
      if (preview.revision !== fresh.revision || JSON.stringify(before) !== JSON.stringify(after)) {
        setPreview(fresh);
        setRequest({ ...request, selected: fresh.uses.filter(use => use.selected).map(use => use.id) });
        throw new Error(zh ? '目录或当前配置已更新，请核对后再次应用。' : 'The catalog or settings changed. Review the updated choices and apply again.');
      }
      if (!fresh.configured) throw new Error(zh ? '请先连接此服务。' : 'Connect this service first.');
      await applyModelSetup(providerId, request, fresh.revision);
      setPreview(fresh); setDone(true); onApplied?.();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError((!inline && savedCredential ? (zh ? '服务已保存，用途配置未完成。' : 'Connection saved; model setup is incomplete. ') : '') + detail);
    } finally { saving.current = false; setBusy(false); }
  };
  const title = preview?.profile.name ?? row?.name ?? providerId;
  const keyUrl = preview?.profile.apiKeyUrl ?? PROVIDER_ENRICHMENT[providerId]?.apiKeyUrl;
  if (inline) {
    const use = preview?.uses.find(use => use.id === targetUse);
    const chosen = targetUse ? request.overrides?.[targetUse] ?? use?.recommended : undefined;
    const displayName = serviceDisplayName(providerId, title, zh);
    return <div className="space-y-6 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-base font-semibold text-fg">{displayName}</h3><p className="mt-1 text-sm text-fg-muted">{targetUse ? `${zh ? '用于' : 'For '}${capabilityLabels[targetUse][zh ? 0 : 1]}` : ''}</p></div><Button variant="ghost" disabled={busy} onClick={onDone}>{zh ? '更换服务' : 'Change service'}</Button></div>
      {!preview && !error ? <Skeleton className="h-48 w-full rounded-xl" /> : null}
      {preview ? <>
        {preview.profile.credential === 'oauth' && !connected ? <OAuthProviderConnect providerId={providerId} displayName={displayName} connected={connected} onConnected={handleOAuthConnected} /> : null}
        {preview.profile.credential === 'oauth' && connected && !row?.supportsApiKey ? <p className="flex items-center gap-2 rounded-xl bg-surface-inset px-4 py-3 text-sm text-fg"><CheckCircle2 className="size-4 text-fg-muted" aria-hidden />{zh ? '使用已有连接' : 'Using the existing connection'}</p> : null}
        {(preview.profile.credential === 'api-key' || (preview.profile.credential === 'oauth' && row?.supportsApiKey)) ? <div className="space-y-3">
          {connected && !editingKey ? <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-inset px-4 py-3"><p className="flex items-center gap-2 text-sm text-fg"><CheckCircle2 className="size-4 text-fg-muted" aria-hidden />{zh ? '使用已有连接' : 'Using the existing connection'}</p><Button variant="ghost" disabled={busy} onClick={() => setEditingKey(true)}>{zh ? '更换' : 'Change'}</Button></div> : <>
            <div className="flex items-center justify-between gap-3"><label htmlFor="provider-setup-key" className="text-sm font-medium text-fg">{preview.profile.access === 'subscription' ? (zh ? '订阅 API Key' : 'Subscription API key') : 'API Key'}</label>{connected ? <Button variant="ghost" disabled={busy} onClick={() => { setEditingKey(false); setApiKey(''); }}>{zh ? '保留原 Key' : 'Keep saved key'}</Button> : null}</div>
            <SecretInput id="provider-setup-key" disabled={busy} value={apiKey} onChange={setApiKey} placeholder={connected ? (zh ? '输入新的 API Key' : 'Enter a new API key') : (zh ? '粘贴 API Key' : 'Paste your API key')} labels={secretInputLabelsFromChannels(messages(language).providersSettings)} />
            {connected ? <p className="text-xs leading-relaxed text-fg-muted">{zh ? '此服务的其他已配置模型也会使用新的 Key。' : 'Other models configured with this service will also use the new key.'}</p> : null}
            {keyUrl ? <a className="inline-flex min-h-10 items-center text-sm text-accent-fg hover:underline" href={keyUrl} target="_blank" rel="noopener noreferrer">{zh ? '获取 API Key' : 'Get an API key'}</a> : null}
          </>}
        </div> : null}
        {use ? <div className="space-y-2"><label className="block text-sm font-medium text-fg">{zh ? '选择模型' : 'Model'}</label><Select value={chosen ?? ''} disabled={busy || !use.choices.length} aria-label={zh ? '选择模型' : 'Model'} onChange={event => setRequest({ ...request, selected: [use.id], overrides: { ...request.overrides, [use.id]: event.target.value } })}>{use.choices.map(model => <SelectOption key={model.id} value={model.id}>{model.name}</SelectOption>)}</Select></div> : null}
        <p className="text-sm leading-relaxed text-fg-muted">{zh ? '只更改当前能力使用的模型。' : 'Changes the model for this capability only.'}{preview.profile.interactiveOnly ? (zh ? ' 后台任务继续使用原服务。' : ' Background tasks keep their current service.') : ''}</p>
      </> : null}
      {error ? <div role="alert" className="space-y-2 rounded-xl border border-edge p-3"><p className="text-sm text-danger">{credentialSaved ? (zh ? '连接信息已保存，模型尚未切换。请重试。' : 'Connection saved. The model has not switched; please retry.') : (zh ? '未能应用配置，请重试。' : 'Could not apply settings. Please retry.')}</p><details className="text-xs text-fg-muted"><summary className="cursor-pointer">{zh ? '查看详情' : 'Show details'}</summary><p className="mt-2 break-words">{error}</p></details></div> : null}
      <div className="flex items-center justify-end gap-3 border-t border-edge-subtle pt-4"><Button variant="primary" disabled={busy || (!preview && !error) || (Boolean(preview) && ((!connected && !apiKey.trim()) || !chosen || !use?.choices.some(model => model.id === chosen)))} onClick={() => { if (!preview) setAttempt(value => value + 1); else void save(); }}>{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{busy ? (zh ? '正在应用…' : 'Applying…') : !preview && error ? (zh ? '重新加载' : 'Reload') : error ? (zh ? '重试' : 'Retry') : connected && !apiKey.trim() ? (zh ? '使用此模型' : 'Use this model') : (zh ? '连接并使用' : 'Connect and use')}</Button></div>
    </div>;
  }
  const Title = inline ? 'h3' : Dialog.Title;
  const Description = inline ? 'p' : Dialog.Description;
  return <>
    <div className="flex shrink-0 items-start gap-3 px-5 py-5">
      {onBack && !busy && !done ? <Button variant="ghost" className="shrink-0 p-1.5" aria-label={zh ? '返回' : 'Back'} onClick={onBack}><ChevronLeft className="size-4" /></Button> : null}
      <div className="min-w-0 flex-1"><Title className="text-base font-semibold text-fg">{targetUse ? `${zh ? '连接服务 · ' : 'Connect service · '}${labels[targetUse][zh ? 0 : 1]}` : (zh ? '连接模型服务' : 'Connect model service')}</Title><Description className="mt-2 text-sm text-fg-muted">{title}</Description></div>
      <Button variant="ghost" className="shrink-0 p-1.5" disabled={busy} aria-label={zh ? '关闭' : 'Close'} onClick={onDone}><X className="size-4" /></Button>
    </div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
      {!preview && !error ? <Skeleton className="h-64 w-full rounded-xl" /> : null}
      {preview ? <>
        {!done && alternatives.length > 1 && onChooseProvider ? <div><label className="mb-2 block text-xs text-fg-muted">{zh ? '接入方式 / 地域' : 'Access method / region'}</label><Select value={providerId} disabled={busy} aria-label={zh ? '接入方式 / 地域' : 'Access method / region'} onChange={event => onChooseProvider(event.target.value)}>{alternatives.map(option => <SelectOption key={option.id} value={option.id}>{option.setupProfile?.name ?? option.name}</SelectOption>)}</Select></div> : null}
        {done ? <p role="status" className="flex items-center gap-2 text-sm text-fg"><CheckCircle2 className="size-4" />{connectOnly ? (zh ? '服务连接已保存' : 'Connection saved') : (zh ? '所选用途配置已保存' : 'Selected model uses saved')}</p> : <>
          {preview.profile.credential === 'oauth' && !connected ? <OAuthProviderConnect providerId={providerId} displayName={title} connected={connected} onConnected={handleOAuthConnected} /> : null}
          {connected && !editingKey ? <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-surface-inset px-4 py-3">
            <div className="flex min-w-0 items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden /><div><p className="text-sm font-medium text-fg">{zh ? '服务已连接' : 'Service connected'}</p><p className="mt-1 text-sm text-fg-muted">{zh ? '可直接选择模型，无需重复填写凭据。' : 'Choose a model without entering credentials again.'}</p></div></div>
            {!existingConnection && (preview.profile.credential === 'api-key' || row?.supportsApiKey) ? <Button variant="ghost" disabled={busy} onClick={() => setEditingKey(true)}>{zh ? '更换 API Key' : 'Change API key'}</Button> : null}
          </div> : null}
          {(preview.profile.credential === 'api-key' || (preview.profile.credential === 'oauth' && row?.supportsApiKey)) && !existingConnection && (!connected || editingKey) ? <div className="space-y-2">
            <div className="flex items-center justify-between gap-3"><label htmlFor="provider-setup-key" className="text-sm font-medium text-fg">{preview.profile.access === 'subscription' ? (zh ? '套餐 API Key' : 'Plan API key') : 'API Key'}</label>{connected ? <Button variant="ghost" disabled={busy} onClick={() => { setEditingKey(false); setApiKey(''); }}>{zh ? '取消更换' : 'Cancel change'}</Button> : null}</div>
            <SecretInput id="provider-setup-key" disabled={busy} value={apiKey} onChange={setApiKey} placeholder={connected ? (zh ? '输入新的 API Key' : 'Enter a new API key') : 'API Key'} labels={secretInputLabelsFromChannels(messages(language).providersSettings)} />
            {keyUrl ? <a className="inline-flex min-h-8 items-center text-sm text-accent-fg hover:underline" href={keyUrl} target="_blank" rel="noopener noreferrer">{zh ? '获取对应接入方式的 Key' : 'Get a key for this access method'}</a> : null}
          </div> : null}
          {!connectOnly && !inline ? <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-fg">{zh ? '模型用途' : 'Model uses'}</span><SlidingTabList className="flex gap-2" indicatorClassName="rounded-lg bg-surface-active">
            {(['fill', 'replace'] as const).map(mode => <Button key={mode} variant={request.mode === mode ? 'secondary' : 'ghost'} disabled={busy} aria-pressed={request.mode === mode} onClick={() => changeMode(mode)}>{mode === 'fill' ? (zh ? '补齐未配置' : 'Fill missing') : (zh ? '改用此服务' : 'Switch to this service')}</Button>)}
          </SlidingTabList></div> : <p className="text-sm text-fg-muted">{inline ? (zh ? '仅更新当前能力，其他模型和参数保持原设置。' : 'Only this capability changes; other settings are preserved.') : (connected ? (zh ? '连接已就绪，返回能力设置选择要使用的模型。' : 'The connection is ready. Return to capability settings to choose a model.') : (zh ? '保存连接后返回能力设置，再选择要使用的模型。' : 'Save the connection, then choose a model in capability settings.'))}</p>}
        </>}
        {connectOnly ? <p className="text-xs text-fg-muted">{zh ? '支持用途：' : 'Supported uses: '}{preview.uses.filter(use => use.choices.length && (!targetUse || use.id === targetUse)).map(use => labels[use.id][zh ? 0 : 1]).join('、')}</p> : null}
        {!connectOnly ? <div className="divide-y divide-edge rounded-xl border border-edge bg-surface-inset px-4">
          {preview.uses.filter(use => !inline || !targetUse || use.id === targetUse).map(use => {
            const chosen = request.overrides?.[use.id] ?? use.recommended;
            const choice = use.choices.find(model => model.id === chosen);
            return <div key={use.id} className="space-y-2 py-3">
              <label className="flex min-h-10 items-start gap-3"><input hidden={inline} type="checkbox" className="ui-checkbox mt-1" checked={selected.includes(use.id)} disabled={inline || busy || done || !chosen || !use.choices.length} onChange={event => setRequest({ ...request, selected: event.target.checked ? [...selected, use.id] : selected.filter(id => id !== use.id) })} />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{labels[use.id][zh ? 0 : 1]}</span><span className="mt-1 block break-all text-xs text-fg-muted">{selected.includes(use.id) ? `${use.current ? `${use.current} → ` : ''}${choice?.name ?? chosen ?? ''}` : use.current ? `${zh ? '保留：' : 'Keep: '}${use.current}` : use.reason === 'interactive_only' ? (zh ? '此套餐不用于后台任务' : 'This plan is not used for background tasks') : choice?.name ?? (zh ? '暂无可自动配置的模型' : 'No automatic model selection available')}</span></span>
              </label>
              {!done && use.choices.length > 1 ? <details open={inline || undefined} className="pl-7"><summary className="text-xs text-accent-fg">{zh ? '选择具体模型' : 'Choose a model'}</summary><Select value={chosen ?? ''} disabled={busy} aria-label={labels[use.id][zh ? 0 : 1]} onChange={event => setRequest({ ...request, selected: [...new Set([...selected, use.id])], overrides: { ...request.overrides, [use.id]: event.target.value } })}>{use.choices.map(model => <SelectOption key={model.id} value={model.id}>{model.name}</SelectOption>)}</Select></details> : null}
            </div>;
          })}
        </div>
        : null}
        {!done ? <Button variant="ghost" disabled={busy} onClick={() => setAttempt(value => value + 1)}>{zh ? '刷新目录' : 'Refresh catalog'}</Button> : null}
        {!connectOnly && !inline ? <details><summary className="text-xs text-accent-fg">{zh ? '任务模型与其他用途' : 'Task models and other uses'}</summary><div className="mt-2 space-y-1 text-xs text-fg-muted">{Object.entries(preview.taskModels).map(([intent, ref]) => <p key={intent}>{intent}: {ref}</p>)}<p>{zh ? '未选用途与电脑操作保留当前配置；所选用途清除跨服务回退。' : 'Unselected uses and Computer Use keep their settings. Selected uses clear cross-service fallbacks.'}</p></div></details> : null}
        {!connectOnly ? <p className="text-xs leading-5 text-fg-muted">{preview.profile.interactiveOnly ? (zh ? '此套餐仅用于交互任务。后台调用会检查使用范围，不会自动切换到其他收费来源。' : 'This plan is for interactive tasks. Background calls check usage scope and do not automatically switch billing sources.') : (zh ? '仅更新勾选的全局用途，智能体和会话的独立设置继续生效。' : 'Only selected global uses change. Agent and session overrides remain effective.')}</p> : null}
        <p className="text-xs text-fg-muted">{zh ? '配置保存与模型真实调用验证分别显示；此操作不会发送测试请求。' : 'Saving settings does not perform a model test request.'}</p>
      </> : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-edge px-5 py-4"><span className="text-xs text-fg-muted">{preview && !done && !connectOnly ? (zh ? `将配置 ${selected.length} 项` : `${selected.length} uses selected`) : ''}</span>
      {done || (connectOnly && connected && !apiKey.trim() && !editingKey) ? <Button disabled={busy || !preview} onClick={() => { if (!done) onApplied?.(); onDone(); }}>{connectOnly ? (zh ? '返回选择模型' : 'Return to model selection') : (zh ? '完成' : 'Done')}</Button> : !preview && error ? <Button onClick={() => setAttempt(value => value + 1)}>{zh ? '重试' : 'Retry'}</Button> : <Button onClick={() => void save()} disabled={busy || !preview || (!connected && !apiKey.trim()) || (inline && !selected.some(id => request.overrides?.[id] || preview.uses.find(use => use.id === id)?.recommended))}>{busy ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}{busy ? (zh ? '正在应用…' : 'Applying…') : selected.length ? (inline && targetUse ? `${zh ? '连接并用于' : 'Connect and use for '}${labels[targetUse][zh ? 0 : 1]}` : (zh ? '连接并应用' : 'Connect and apply')) : (zh ? '仅连接' : 'Connect only')}</Button>}
    </div>
  </>;
}
