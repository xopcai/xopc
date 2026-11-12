import { compareModelNamesDescending } from '@/lib/model-sort';
import { modelDisplayName } from '@/lib/model-display-name';
import useSWR from 'swr';
import { HIGGS_REALTIME_REF } from '@xopcai/realtime-protocol/voice';
import { apiUrl } from '@/lib/url';
import { bosonVoiceSettingsUrl, fetchBosonVoiceSettings, fetchVoiceProviders, fetchVoiceSttProviders, saveBosonVoiceSettings } from '@/features/settings/voice-config-api';
import { modelsJsonPresetKeyForProviderId } from '@/features/settings/models/models-settings-lib';
import { fetchImageCatalog } from '@/features/settings/image-generation-api';
import { capabilityDescriptions, serviceDisplayName } from './capability-presentation';
import { capabilityGroups, capabilityLabels } from './capability-navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { ModelSetupPreview, ModelSetupRequest, ModelSetupUse } from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PopoverSelect, type PopoverSelectOption } from '@/components/ui/popover-select';
import { fetchGlobalDefaults } from '@/features/settings/global-defaults-api';
import { revalidateGatewayConfig, useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { normalizeVoiceSettings } from '@/features/settings/voice-config-api';
import type { ConnectedProvidersData } from './connected-providers-grid';
import { ModelUseGroup, ModelUseRow, ModelUseService } from './model-use-layout';
import { applyModelSetup, fetchModelSetup, previewModelSetup } from './provider-setup-api';

const CLEAR_NATURAL_MODEL = 'clear-natural-model';

type ModelUseOption = PopoverSelectOption & { searchText?: string };

function ModelUsePicker({ label, value, currentLabel, options, loading, disabled, zh, onConnect, onManage, onSelect }: {
  label: string; value?: string; currentLabel?: string; options: ModelUseOption[]; loading: boolean; disabled: boolean; zh: boolean; onConnect: () => void; onManage?: () => void; onSelect: (ref: string) => void;
}) {
  const [query, setQuery] = useState('');
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = [...options].sort((left, right) =>
    (left.group ?? '').localeCompare(right.group ?? '', 'en', { numeric: true, sensitivity: 'base' })
    || compareModelNamesDescending(left.label, right.label)
    || compareModelNamesDescending(left.value, right.value),
  ).filter(option => {
    const text = `${option.label} ${option.group} ${option.value} ${option.searchText ?? ''}`.toLowerCase();
    return terms.every(term => text.includes(term));
  });
  const selected = options.find(option => option.value === value);
  const source = selected?.group ?? options.find(option => option.value.split('/')[0] === value?.split('/')[0])?.group;
  const modelLabel = selected?.label ?? (value?.endsWith('/default') ? (zh ? '默认模型' : 'Default model') : currentLabel ?? value);
  const selectedLabel = source ? `${modelLabel} · ${source}` : modelLabel;
  if (!loading && !options.length) return <Button variant="secondary" className="min-h-11 w-full sm:justify-start" aria-label={`${zh ? '连接' : 'Connect'} ${label}`} disabled={disabled} onClick={onConnect}>{zh ? '连接服务以启用' : 'Connect a service to enable'}</Button>;
  return <div className="space-y-0.5"><PopoverSelect value={value ?? ''} options={filtered} selectedLabel={modelLabel} title={selectedLabel}
    placeholder={zh ? '选择模型' : 'Choose a model'} ariaLabel={`${zh ? '选择' : 'Select'} ${label}`}
    allowEmpty={false} disabled={disabled} loading={loading} onChange={onSelect}
    searchPlaceholder={zh ? '搜索模型或服务' : 'Search models or services'} searchValue={query} onSearchChange={setQuery}
    statusMessage={!filtered.length ? (zh ? '没有可用模型' : 'No available models') : undefined}
    triggerClassName="min-h-11" />
    <ModelUseService name={source} manageLabel={zh ? '管理服务' : 'Manage services'} onManage={onManage} disabled={disabled} />
  </div>;
}

/** Reads effective global routes rather than maintaining a separate assignment store. */
export function ModelUsesList({ data, zh, onChange, onSettings, onlyUse, disabled = false, onPendingChange, videoRow }: { videoRow?: ReactNode; data: ConnectedProvidersData; zh: boolean; onChange: (use: ModelSetupUse) => void; onSettings?: (use: ModelSetupUse) => void; onlyUse?: ModelSetupUse; disabled?: boolean; onPendingChange?: (pending: boolean) => void }) {
  const { data: result, error, mutate } = useSWR('settings-agent-defaults', fetchGlobalDefaults);
  const { data: voiceConfig } = useGatewayConfigSwr(true);
  const { data: boson, mutate: mutateBoson } = useSWR(!onlyUse || onlyUse === 'conversation'
    ? apiUrl(bosonVoiceSettingsUrl) : null, fetchBosonVoiceSettings);
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
    const selectsBoson = use === 'conversation' && (model === HIGGS_REALTIME_REF || model === CLEAR_NATURAL_MODEL);
    if (!source && !selectsBoson) return;
    savingRef.current = true; onPendingChange?.(true);
    setSaving(use); setFeedback(null);
    const request: ModelSetupRequest = { mode: 'replace', selected: [use], overrides: { [use]: model } };
    try {
      if (selectsBoson) {
        await mutateBoson(await saveBosonVoiceSettings({ defaultForNatural: model === HIGGS_REALTIME_REF }), { revalidate: false });
        await revalidateGatewayConfig();
      } else if (source) {
        const preview = await previewModelSetup(source.providerId, request);
        await applyModelSetup(source.providerId, request, preview.revision);
        await Promise.all([mutate(), refreshCatalog(), ...(use === 'conversation' ? [mutateBoson(), revalidateGatewayConfig()] : [])]);
      }
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
  const realtime = voice?.voice.realtime;
  const legacyNaturalRef = realtime?.enabled && realtime.omni ? `${realtime.omni.provider}/${realtime.omni.model}` : undefined;
  const naturalRef = (boson?.defaultForNatural ?? realtime?.boson?.defaultForNatural) ? HIGGS_REALTIME_REF : legacyNaturalRef;
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
    { id: 'conversation', label: zh ? '自然语音模型' : 'Natural voice model', ref: naturalRef },
  ];
  return <section ref={listRef} className="@container min-w-0">
    <h2 className={onlyUse ? "mb-2 text-sm font-semibold text-fg" : "sr-only"}>{onlyUse ? (zh ? '当前模型' : 'Current model') : (zh ? '能力总览' : 'Capabilities')}</h2>
    <div className={onlyUse ? 'space-y-4' : 'overflow-hidden rounded-2xl border border-edge bg-surface-panel'}>{capabilityGroups.filter(group => (!onlyUse || group.uses.includes(onlyUse))).map(group => {
      const groupRows = group.uses.filter(id => !onlyUse || id === onlyUse).map(id => {
        const row = rows.find(row => row.id === id)!;
        const options = modelUseOptions(catalog?.previews ?? [], row.id, zh);
        if (row.id === 'conversation') {
          if (boson?.credentialSource || row.ref === HIGGS_REALTIME_REF) options.push({
            value: HIGGS_REALTIME_REF, label: 'Higgs Realtime', group: 'Boson AI', disabled: !boson?.credentialSource,
          });
          if (row.ref === HIGGS_REALTIME_REF && !options.some(option => option.value !== HIGGS_REALTIME_REF)) {
            options.push({ value: CLEAR_NATURAL_MODEL, label: zh ? '取消默认模型' : 'Clear default model' });
          }
        }
        const model = row.ref ? data.allModels.find(model => model.id === row.ref) : undefined;
        const current = model ? modelDisplayName(model, zh ? 'zh' : 'en') : row.ref;
        return <div key={row.id} data-capability={row.id}><ModelUseRow inline={Boolean(onlyUse)} actionColumn={Boolean(onSettings)}
          description={<><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-sm font-medium text-fg">{capabilityLabels[row.id][zh ? 0 : 1]}</p><span className="text-xs text-fg-subtle">{row.ref ? (options.some(option => option.value === row.ref || (row.ref?.endsWith('/default') && option.value.split('/')[0] === row.ref.split('/')[0])) ? null : (zh ? '待连接' : 'Connection needed')) : (zh ? '未配置' : 'Not set up')}</span></div><p className="mt-1 text-xs leading-relaxed text-fg-muted">{capabilityDescriptions[row.id][zh ? 0 : 1]}</p>
            {row.inherited ? <p className="mt-1 text-xs text-fg-muted">{zh ? '继承默认对话' : 'Inherits chat default'}</p> : null}
          </>}
          picker={<>
            <ModelUsePicker label={row.id === 'conversation' ? row.label : capabilityLabels[row.id][zh ? 0 : 1]} value={row.ref} currentLabel={current} options={options} loading={data.loading || loadingCatalog || loadingMedia} disabled={saving !== null || disabled}
              zh={zh} onConnect={() => onChange(row.id)} onManage={onSettings ? () => onChange(row.id) : undefined} onSelect={ref => { if (ref !== row.ref) void switchModel(row.id, ref); }} />
            {saving === row.id ? <p role="status" className="text-xs text-fg-muted">{zh ? '正在切换…' : 'Switching…'}</p> : null}
            {feedback?.use === row.id ? <div role={feedback.error ? 'alert' : 'status'} className="text-xs text-fg-muted">{feedback.error ? <><p className="text-danger">{zh ? '未能切换模型，请重试。' : 'Could not switch models. Please retry.'}</p><details className="mt-1"><summary className="cursor-pointer">{zh ? '查看详情' : 'Show details'}</summary><p className="mt-1 break-words">{feedback.error}</p></details></> : (zh ? '已切换' : 'Model changed')}</div> : null}
          </>}
          actions={onSettings && (row.id === 'conversation' || options.length > 0 || loadingCatalog || loadingMedia) ? <Button variant="ghost" className="min-h-11" disabled={saving !== null || disabled} onClick={() => onSettings(row.id)}>{zh ? '设置' : 'Settings'}</Button> : null}
        /></div>;
      });
      return onlyUse ? <div key={group.uses[0]} className="min-w-0 divide-y divide-edge-subtle">{groupRows}</div>
        : <ModelUseGroup key={group.uses[0]} section={group.uses[0]} title={group.label[zh ? 0 : 1]}>
          {groupRows}
          {group.uses.includes('vision') && videoRow}
        </ModelUseGroup>;
    })}</div>
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
