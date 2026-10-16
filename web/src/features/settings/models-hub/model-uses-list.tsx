import useSWR from 'swr';
import { useRef, useState } from 'react';
import type { ModelSetupPreview, ModelSetupRequest, ModelSetupUse } from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PopoverSelect, type PopoverSelectOption } from '@/components/ui/popover-select';
import { fetchGlobalDefaults } from '@/features/settings/global-defaults-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { normalizeVoiceSettings } from '@/features/settings/voice-config-api';
import type { ConnectedProvidersData } from './connected-providers-grid';
import { applyModelSetup, fetchModelSetup, previewModelSetup } from './provider-setup-api';

function ModelUsePicker({ label, value, currentLabel, options, loading, disabled, zh, onSelect }: {
  label: string; value?: string; currentLabel?: string; options: PopoverSelectOption[]; loading: boolean; disabled: boolean; zh: boolean; onSelect: (ref: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = options.filter(option => `${option.label} ${option.group} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = options.find(option => option.value === value);
  const selectedLabel = selected ? `${selected.label} · ${selected.group}` : currentLabel ?? value;
  return <PopoverSelect value={value ?? ''} options={filtered} selectedLabel={selectedLabel} title={selectedLabel}
    placeholder={zh ? '选择模型' : 'Choose a model'} ariaLabel={`${zh ? '选择' : 'Select'} ${label}`}
    allowEmpty={false} disabled={disabled} loading={loading} onChange={onSelect}
    searchPlaceholder={zh ? '搜索模型或服务' : 'Search models or services'} searchValue={query} onSearchChange={setQuery}
    statusMessage={!filtered.length ? (zh ? '没有可用模型' : 'No available models') : undefined}
    triggerClassName="min-h-11" />;
}

/** Reads effective global routes rather than maintaining a separate assignment store. */
export function ModelUsesList({ data, zh, onChange }: { data: ConnectedProvidersData; zh: boolean; onChange: (use: ModelSetupUse) => void }) {
  const { data: result, error, mutate } = useSWR('settings-agent-defaults', fetchGlobalDefaults);
  const { data: voiceConfig } = useGatewayConfigSwr(true);
  const providers = data.cards.filter(card => card.configured).map(card => card.id).sort();
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
  const switchModel = async (use: ModelSetupUse, model: string) => {
    if (savingRef.current) return;
    const source = catalog?.previews.find(preview => preview.uses.some(row => row.id === use && row.choices.some(choice => choice.id === model)));
    if (!source) return;
    savingRef.current = true;
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
    } finally { savingRef.current = false; setSaving(null); }
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
    { id: 'transcription', label: zh ? '录音识别' : 'Recorded audio recognition', ref: voice?.stt.enabled ? `${voice.stt.provider}/${voice.stt.providers?.[voice.stt.provider]?.model ?? 'default'}` : undefined },
    { id: 'speech', label: zh ? '语音合成' : 'Speech synthesis', ref: voice?.tts.enabled ? `${voice.tts.provider}/${voice.tts.providers?.[voice.tts.provider]?.model ?? 'default'}` : undefined },
    { id: 'conversation', label: zh ? '实时语音对话' : 'Realtime conversation', ref: voice?.voice.realtime.enabled && voice.voice.realtime.defaultEngine === 'omni' && voice.voice.realtime.omni ? `${voice.voice.realtime.omni.provider}/${voice.voice.realtime.omni.model}` : undefined },
  ];
  return <section className="min-w-0 rounded-xl border border-edge bg-surface-panel p-4">
    <h2 className="mb-2 text-sm font-semibold text-fg">{zh ? '模型用途' : 'Model uses'}</h2>
    <div className="divide-y divide-edge-subtle">{rows.map(row => {
      const options = modelUseOptions(catalog?.previews ?? [], row.id);
      const current = row.ref ? data.allModels.find(model => model.id === row.ref)?.name ?? row.ref : undefined;
      return <div key={row.id} className="flex min-h-16 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0"><p className="text-sm font-medium text-fg">{row.label}</p>
          {row.inherited ? <p className="mt-1 text-xs text-fg-muted">{zh ? '继承默认对话' : 'Inherits chat default'}</p> : null}
          {row.id === 'background' ? <p className="mt-1 text-xs text-fg-muted">{zh ? '仅显示支持后台调用的模型' : 'Only background-capable models are listed'}</p> : null}
        </div>
        <div className="w-full min-w-0 space-y-1 sm:w-1/2 sm:max-w-sm sm:shrink-0">
          <ModelUsePicker label={row.label} value={row.ref} currentLabel={current} options={options} loading={data.loading || loadingCatalog} disabled={saving !== null}
            zh={zh} onSelect={ref => { if (ref !== row.ref) void switchModel(row.id, ref); }} />
          {saving === row.id ? <p role="status" className="text-xs text-fg-muted">{zh ? '正在切换…' : 'Switching…'}</p> : null}
          {feedback?.use === row.id ? <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'text-xs text-danger' : 'text-xs text-fg-muted'}>{feedback.error ?? (zh ? '已切换' : 'Model changed')}</p> : null}
          {!loadingCatalog && !data.loading && !options.length ? <Button variant="ghost" disabled={saving !== null} onClick={() => onChange(row.id)}>{zh ? '接入模型服务' : 'Connect a model service'}</Button> : null}
        </div>
      </div>;
    })}</div>
    {catalog?.failed ? <p role="alert" className="mt-2 text-xs text-danger">{zh ? '部分服务的模型加载失败' : 'Some model services could not be loaded'}<Button variant="ghost" onClick={() => void refreshCatalog()}>{zh ? '重试' : 'Retry'}</Button></p> : null}
    <p className="mt-2 text-xs text-fg-muted">{zh ? '快速与复杂任务模型随对话配置；音色、流式听写及电脑操作可在详细设置中调整。' : 'Fast and complex task models follow chat setup. Voices, streaming dictation and Computer Use have detailed settings.'}</p>
  </section>;
}

/** Server previews are authoritative for capabilities and token-plan usage restrictions. */
export function modelUseOptions(previews: ModelSetupPreview[], use: ModelSetupUse): PopoverSelectOption[] {
  return previews.flatMap(preview => preview.uses.find(row => row.id === use)?.choices.map(choice => ({
    value: choice.id, label: choice.name, group: preview.profile.name,
  })) ?? []);
}
