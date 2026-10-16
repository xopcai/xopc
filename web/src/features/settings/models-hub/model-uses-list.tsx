import useSWR from 'swr';
import { fetchVoiceProviders, fetchVoiceSttProviders } from '@/features/settings/voice-config-api';
import { modelsJsonPresetKeyForProviderId } from '@/features/settings/models/models-settings-lib';
import { fetchImageCatalog } from '@/features/settings/image-generation-api';
import { capabilityDescriptions, serviceDisplayName } from './capability-presentation';
import { capabilityGroups, capabilityLabels } from './capability-navigation';
import { useEffect, useRef, useState } from 'react';
import type { ModelSetupPreview, ModelSetupRequest, ModelSetupUse } from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PopoverSelect, type PopoverSelectOption } from '@/components/ui/popover-select';
import { fetchGlobalDefaults } from '@/features/settings/global-defaults-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { normalizeVoiceSettings } from '@/features/settings/voice-config-api';
import type { ConnectedProvidersData } from './connected-providers-grid';
import { applyModelSetup, fetchModelSetup, previewModelSetup } from './provider-setup-api';

type ModelUseOption = PopoverSelectOption & { searchText?: string };

function ModelUsePicker({ label, value, currentLabel, options, loading, disabled, zh, onConnect, onSelect }: {
  label: string; value?: string; currentLabel?: string; options: ModelUseOption[]; loading: boolean; disabled: boolean; zh: boolean; onConnect: () => void; onSelect: (ref: string) => void;
}) {
  const [query, setQuery] = useState('');
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = options.filter(option => {
    const text = `${option.label} ${option.group} ${option.value} ${option.searchText ?? ''}`.toLowerCase();
    return terms.every(term => text.includes(term));
  });
  const selected = options.find(option => option.value === value);
  const source = selected?.group ?? options.find(option => option.value.split('/')[0] === value?.split('/')[0])?.group;
  const modelLabel = selected?.label ?? (value?.endsWith('/default') ? (zh ? '默认模型' : 'Default model') : currentLabel ?? value);
  const selectedLabel = source ? `${modelLabel} · ${source}` : modelLabel;
  if (!loading && !options.length) return <Button variant="secondary" className="min-h-11 w-full sm:justify-start" aria-label={`${zh ? '连接' : 'Connect'} ${label}`} disabled={disabled} onClick={onConnect}>{zh ? '连接服务以启用' : 'Connect a service to enable'}</Button>;
  return <div className="space-y-1.5"><PopoverSelect value={value ?? ''} options={filtered} selectedLabel={modelLabel} title={selectedLabel}
    placeholder={zh ? '选择模型' : 'Choose a model'} ariaLabel={`${zh ? '选择' : 'Select'} ${label}`}
    allowEmpty={false} disabled={disabled} loading={loading} onChange={onSelect}
    searchPlaceholder={zh ? '搜索模型或服务' : 'Search models or services'} searchValue={query} onSearchChange={setQuery}
    statusMessage={!filtered.length ? (zh ? '没有可用模型' : 'No available models') : undefined}
    triggerClassName="min-h-11" />{source ? <p className="px-1 text-xs text-fg-muted">{source}</p> : null}</div>;
}

/** Reads effective global routes rather than maintaining a separate assignment store. */
export function ModelUsesList({ data, zh, onChange, onSettings, onlyUse, disabled = false, onPendingChange, voiceOverview = false }: { data: ConnectedProvidersData; zh: boolean; onChange: (use: ModelSetupUse) => void; onSettings?: (use: ModelSetupUse) => void; onlyUse?: ModelSetupUse; voiceOverview?: boolean; returnTo?: string; disabled?: boolean; onPendingChange?: (pending: boolean) => void }) {
  const { data: result, error, mutate } = useSWR('settings-agent-defaults', fetchGlobalDefaults);
  const { data: voiceConfig } = useGatewayConfigSwr(true);
  const { data: media, isLoading: loadingMedia, error: mediaError, mutate: refreshMedia } = useSWR('model-capability-media-sources', async () => {
    const results = await Promise.allSettled([fetchVoiceProviders(), fetchVoiceSttProviders(), fetchImageCatalog()]);
    return { ids: [...new Set(results.flatMap(result => result.status === 'fulfilled' ? (Array.isArray(result.value) ? result.value : result.value.providers).filter(entry => entry.configured).map(entry => entry.id) : []))], failed: results.some(result => result.status === 'rejected') };
  });
  const providers = [...new Set([...data.cards.filter(card => card.configured && (!modelsJsonPresetKeyForProviderId(card.id) || Boolean(data.customConfig?.providers?.[card.id]))).map(card => card.id), ...(media?.ids ?? [])])].sort();
  const { data: catalog, isLoading: loadingCatalog, mutate: refreshCatalog } = useSWR(
    data.loading ? null : ['model-use-choices', ...providers],
    async () => {
      const results = await Promise.allSettled(providers.map(fetchModelSetup));
      return {
        previews: results.flatMap(result => result.status === 'fulfilled' && result.value.configured ? [result.value] : []),
        failed: results.some(result => result.status === 'rejected'),
      };
    }, { revalidateOnFocus: false },
  );
  const [saving, setSaving] = useState<ModelSetupUse | null>(null);
  const [feedback, setFeedback] = useState<{ use: ModelSetupUse; error?: string } | null>(null);
  const savingRef = useRef(false);
  const listRef = useRef<HTMLElement>(null);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const switchModel = async (use: ModelSetupUse, model: string) => {
    if (savingRef.current || disabled) return;
    const source = catalog?.previews.find(preview => preview.uses.some(row => row.id === use && row.choices.some(choice => choice.id === model)));
    if (!source) return;
    savingRef.current = true; onPendingChange?.(true);
    setSaving(use); setFeedback(null);
    const request: ModelSetupRequest = { mode: 'replace', selected: [use], overrides: { [use]: model } };
    try {
      const preview = await previewModelSetup(source.providerId, request);
      await applyModelSetup(source.providerId, request, preview.revision);
      await Promise.all([mutate(), refreshCatalog()]);
      setFeedback({ use });
    } catch (cause) {
      setFeedback({ use, error: cause instanceof Error ? cause.message : String(cause) });
      void Promise.allSettled([mutate(), refreshCatalog()]);
    } finally {
      savingRef.current = false; setSaving(null); onPendingChange?.(false);
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-capability="${use}"] button[aria-label]`)?.focus());
    }
  };
  const voice = voiceConfig?.payload?.config ? normalizeVoiceSettings(voiceConfig.payload.config) : undefined;
  if (!result && !error) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (error) return <div role="alert" className="text-sm text-danger">{zh ? '模型用途加载失败' : 'Could not load model uses'}<Button variant="ghost" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></div>;
  const models = result!.defaults.models;
  const backgroundFallback = models.background?.primary ?? models.chat.primary;
  const backgroundAllowed = data.builtinRows.find(row => row.id === backgroundFallback.split('/')[0])?.setupProfile?.interactiveOnly !== true;
  const backgroundState = catalog?.previews[0]?.uses.find(use => use.id === 'background');
  const backgroundRef = backgroundState ? backgroundState.current : backgroundAllowed ? backgroundFallback : undefined;
  const rows: Array<{ id: ModelSetupUse; label: string; ref?: string; inherited?: boolean }> = [
    { id: 'chat', label: zh ? '对话与任务' : 'Chat and tasks', ref: models.chat.primary },
    { id: 'vision', label: zh ? '看图' : 'Image understanding', ref: models.imageUnderstanding?.primary },
    { id: 'image', label: zh ? '画图' : 'Image generation', ref: models.imageGeneration?.primary },
    { id: 'background', label: zh ? '后台任务' : 'Background tasks', ref: backgroundRef, inherited: !models.background && Boolean(backgroundRef) },
    { id: 'transcription', label: zh ? '录音与听写' : 'Recording and dictation', ref: voice?.stt.enabled ? `${voice.stt.provider}/${voice.stt.providers?.[voice.stt.provider]?.model ?? 'default'}` : undefined },
    { id: 'speech', label: zh ? '语音合成' : 'Speech synthesis', ref: voice?.tts.enabled ? `${voice.tts.provider}/${voice.tts.providers?.[voice.tts.provider]?.model ?? 'default'}` : undefined },
    { id: 'conversation', label: zh ? '实时语音对话' : 'Realtime conversation', ref: voice?.voice.realtime.enabled ? voice.voice.realtime.defaultEngine === 'omni' && voice.voice.realtime.omni ? `${voice.voice.realtime.omni.provider}/${voice.voice.realtime.omni.model}` : voice.voice.realtime.defaultEngine === 'agent' ? 'agent' : undefined : undefined },
  ];
  return <section ref={listRef} className="@container min-w-0">
    <h2 className={onlyUse ? "mb-2 text-sm font-semibold text-fg" : "sr-only"}>{onlyUse ? (zh ? '当前模型' : 'Current model') : (zh ? '能力总览' : 'Capabilities')}</h2>
    <div className={onlyUse ? "space-y-4" : "overflow-hidden rounded-2xl border border-edge bg-surface-panel"}>{capabilityGroups.filter(group => (!onlyUse || group.uses.includes(onlyUse)) && (!voiceOverview || group.label[1] === 'Voice')).map(group => <section key={group.uses[0]} className={onlyUse ? 'min-w-0' : 'min-w-0 border-t border-edge first:border-t-0'}>
      {!onlyUse && !voiceOverview ? <div className="flex items-center justify-between bg-surface-inset/55 px-4 py-2"><h3 className="text-xs font-medium text-fg-muted">{group.label[zh ? 0 : 1]}</h3><span className="text-xs text-fg-subtle">{group.uses[0] === 'chat' ? (zh ? '基础能力' : 'Core capability') : (zh ? '按需启用' : 'Optional')}</span></div> : null}
      <div className={onlyUse ? "divide-y divide-edge-subtle" : "divide-y divide-edge-subtle px-4"}>{group.uses.filter(id => !onlyUse || id === onlyUse).map(id => {
      const row = rows.find(row => row.id === id)!;
      const options = modelUseOptions(catalog?.previews ?? [], row.id, zh);
      const current = row.id === 'conversation' && voice?.voice.realtime.enabled && voice.voice.realtime.defaultEngine === 'agent' ? (zh ? '语音助手 · 使用对话、听写和语音输出配置' : 'Voice assistant · Uses chat, dictation and voice output') : row.ref ? data.allModels.find(model => model.id === row.ref)?.name ?? row.ref : undefined;
      return <div key={row.id} data-capability={row.id}><div className={onlyUse ? 'py-2' : `grid grid-cols-1 items-center gap-x-3 gap-y-2 py-3 @min-[40rem]:gap-x-4 ${onSettings ? '@min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_auto]' : '@min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]'}`}>
        <div className={onlyUse ? 'hidden' : 'col-start-1 row-start-1 min-w-0'}><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-sm font-medium text-fg">{capabilityLabels[row.id][zh ? 0 : 1]}</p><span className="text-xs text-fg-subtle">{row.ref ? (options.some(option => option.value === row.ref || (row.ref?.endsWith('/default') && option.value.split('/')[0] === row.ref.split('/')[0])) || row.ref === 'agent' ? null : (zh ? '待连接' : 'Connection needed')) : (zh ? '未配置' : 'Not set up')}</span></div><p className="mt-1 text-xs leading-relaxed text-fg-muted">{capabilityDescriptions[row.id][zh ? 0 : 1]}</p>
          {row.inherited ? <p className="mt-1 text-xs text-fg-muted">{zh ? '继承默认对话' : 'Inherits chat default'}</p> : null}
        </div>
        <div className={onlyUse ? "w-full min-w-0 space-y-1" : "row-start-2 w-full min-w-0 space-y-1 @min-[40rem]:col-span-1 @min-[40rem]:col-start-2 @min-[40rem]:row-start-1"}>
          <ModelUsePicker label={capabilityLabels[row.id][zh ? 0 : 1]} value={row.ref} currentLabel={current} options={options} loading={data.loading || loadingCatalog || loadingMedia} disabled={saving !== null || disabled}
            zh={zh} onConnect={() => onChange(row.id)} onSelect={ref => { if (ref !== row.ref) void switchModel(row.id, ref); }} />
          {saving === row.id ? <p role="status" className="text-xs text-fg-muted">{zh ? '正在切换…' : 'Switching…'}</p> : null}
          {feedback?.use === row.id ? <div role={feedback.error ? 'alert' : 'status'} className="text-xs text-fg-muted">{feedback.error ? <><p className="text-danger">{zh ? '未能切换模型，请重试。' : 'Could not switch models. Please retry.'}</p><details className="mt-1"><summary className="cursor-pointer">{zh ? '查看详情' : 'Show details'}</summary><p className="mt-1 break-words">{feedback.error}</p></details></> : (zh ? '已切换' : 'Model changed')}</div> : null}
        </div>
        {onSettings && (options.length > 0 || loadingCatalog || loadingMedia) ? <div className="row-start-3 flex flex-wrap items-center justify-end gap-1 @min-[40rem]:col-start-3 @min-[40rem]:row-start-1"><Button variant="ghost" disabled={saving !== null || disabled} onClick={() => onSettings(row.id)}>{zh ? '设置' : 'Settings'}</Button><Button variant="ghost" disabled={saving !== null || disabled} onClick={() => onChange(row.id)}>{zh ? '管理服务' : 'Manage services'}</Button></div> : null}
      </div></div>;
    })}</div></section>)}</div>
    {(!onSettings || onlyUse) && (catalog?.failed || media?.failed || mediaError) ? <p role="alert" className="mt-2 text-xs text-danger">{zh ? '部分服务的模型加载失败' : 'Some model services could not be loaded'}<Button variant="ghost" onClick={() => void Promise.all([refreshMedia(), refreshCatalog()])}>{zh ? '重试' : 'Retry'}</Button></p> : null}
    {onlyUse || onSettings ? null : <p className="mt-2 text-xs text-fg-muted">{zh ? '快速与复杂任务模型随对话配置；音色、流式听写及电脑操作可在详细设置中调整。' : 'Fast and complex task models follow chat setup. Voices, streaming dictation and Computer Use have detailed settings.'}</p>}
  </section>;
}

/** Server previews are authoritative for capabilities and token-plan usage restrictions. */
export function modelUseOptions(previews: ModelSetupPreview[], use: ModelSetupUse, zh = false): ModelUseOption[] {
  return previews.flatMap(preview => preview.uses.find(row => row.id === use)?.choices.map(choice => ({
    value: choice.id, label: choice.name, group: serviceDisplayName(preview.providerId, preview.profile.name, zh), searchText: preview.profile.name,
  })) ?? []);
}
