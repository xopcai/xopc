import { X } from 'lucide-react';
import { useMemo } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import {
  CONFIGURED_MODELS_SWR_KEY,
  fetchConfiguredModelsCached,
  type ConfiguredModel,
} from '@/features/chat/api/registry-api';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { AgentDefaultsVoiceSummary } from '@/features/settings/agent-defaults/agent-defaults-voice-summary';
import { fetchImageCatalog } from '@/features/settings/image-generation-api';
import type { AgentDefaults, ModelIntent, ModelRoute } from '@/features/settings/types/agent-gateway';

const INTENTS: ModelIntent[] = ['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'];
const inputClass = 'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

const intentCopy = {
  en: {
    fast: ['Fast tasks', 'Short, low-latency work'],
    reasoning: ['Complex reasoning', 'Planning and multi-step analysis'],
    coding: ['Coding', 'Implementation and debugging'],
    review: ['Review', 'Critique and verification'],
    vision: ['Vision', 'Image and visual analysis'],
    understanding: ['Understanding', 'Long-form content comprehension'],
  },
  zh: {
    fast: ['快速任务', '简短、低延迟的工作'],
    reasoning: ['复杂推理', '规划和多步骤分析'],
    coding: ['编程', '实现、调试和代码修改'],
    review: ['审查', '检查、批评和验证'],
    vision: ['视觉任务', '图片和视觉内容分析'],
    understanding: ['内容理解', '长内容阅读和理解'],
  },
} as const;

function updateRoute(route: ModelRoute | undefined, primary: string): ModelRoute {
  return { primary, fallbacks: route?.fallbacks ?? [] };
}

function FallbackModels({
  primary,
  value,
  models,
  loading,
  error,
  zh,
  onChange,
}: {
  primary: string;
  value: string[];
  models: ConfiguredModel[];
  loading: boolean;
  error: unknown;
  zh: boolean;
  onChange: (value: string[]) => void;
}) {
  const candidates = useMemo(
    () => models.filter((model) => model.id !== primary && !value.includes(model.id)),
    [models, primary, value],
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-fg">{zh ? '回退顺序' : 'Fallback order'}</h4>
          <p className="mt-1 text-xs text-fg-muted">{zh ? '主模型不可用时，按从左到右的顺序尝试。' : 'Tried from left to right when the primary model is unavailable.'}</p>
        </div>
      </div>
      {value.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {value.map((model, index) => (
            <span key={model} className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface-panel py-1 pl-2.5 pr-1 text-xs text-fg">
              <span className="text-fg-subtle">{index + 1}</span>
              <span>{models.find((candidate) => candidate.id === model)?.name ?? model}</span>
              <button type="button" aria-label={zh ? `移除 ${model}` : `Remove ${model}`} className="rounded-full p-1 text-fg-muted hover:bg-surface-hover hover:text-fg" onClick={() => onChange(value.filter((item) => item !== model))}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      ) : <p className="mt-3 text-xs text-fg-subtle">{zh ? '未设置回退模型。' : 'No fallback models configured.'}</p>}
      <ModelSelector
        value=""
        models={candidates}
        modelsLoading={loading}
        modelsError={error}
        placeholder={zh ? '添加回退模型' : 'Add fallback model'}
        searchPlaceholder={zh ? '搜索模型或服务商' : 'Search models or providers'}
        noMatches={zh ? '没有可添加的模型' : 'No models available to add'}
        showProviderInTrigger={false}
        contentAlign="start"
        className="mt-3 w-full max-w-md"
        ariaLabel={zh ? '添加回退模型' : 'Add fallback model'}
        onChange={(model) => { if (model) onChange([...value, model]); }}
      />
    </div>
  );
}

export function AgentDefaultsModelsPanel({
  draft,
  setDraft,
  zh,
}: {
  draft: AgentDefaults;
  setDraft: (draft: AgentDefaults) => void;
  zh: boolean;
}) {
  const modelsQuery = useSWR(CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, { revalidateOnFocus: false });
  const imageQuery = useSWR('agent-defaults-image-models', fetchImageCatalog, { revalidateOnFocus: false });
  const models = modelsQuery.data ?? [];
  const imageModels = useMemo<ConfiguredModel[]>(
    () => (imageQuery.data ?? []).flatMap((provider) => provider.models.map((model) => ({
      id: `${provider.id}/${model}`,
      name: model,
      provider: provider.label,
    }))),
    [imageQuery.data],
  );
  const copy = zh ? intentCopy.zh : intentCopy.en;

  const setIntent = (intent: ModelIntent, model: string) => {
    const intents = { ...draft.models.intents };
    if (model) intents[intent] = updateRoute(intents[intent], model);
    else delete intents[intent];
    setDraft({ ...draft, models: { ...draft.models, intents } });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-edge bg-surface-base p-5">
        <div>
          <h2 className="text-base font-semibold text-fg">{zh ? '默认对话模型' : 'Default conversation model'}</h2>
          <p className="mt-1 text-sm text-fg-muted">{zh ? '大多数对话和没有专用路由的任务都会使用它。' : 'Used for most conversations and every task without a dedicated route.'}</p>
        </div>
        <div className="mt-5 max-w-xl">
          <label className="block text-xs font-medium text-fg-muted">{zh ? '主模型' : 'Primary model'}</label>
          <ModelSelector
            value={draft.models.chat.primary}
            placeholder={zh ? '选择模型' : 'Select a model'}
            searchPlaceholder={zh ? '搜索模型或服务商' : 'Search models or providers'}
            noMatches={zh ? '没有匹配的模型' : 'No matching models'}
            showProviderSettingsFooter
            contentAlign="start"
            className="mt-2 w-full"
            ariaLabel={zh ? '默认对话模型' : 'Default conversation model'}
            onChange={(primary) => setDraft({ ...draft, models: { ...draft.models, chat: { ...draft.models.chat, primary } } })}
          />
        </div>
        <div className="mt-6 border-t border-edge pt-5">
          <FallbackModels
            primary={draft.models.chat.primary}
            value={draft.models.chat.fallbacks}
            models={models}
            loading={modelsQuery.isLoading}
            error={modelsQuery.error}
            zh={zh}
            onChange={(fallbacks) => setDraft({ ...draft, models: { ...draft.models, chat: { ...draft.models.chat, fallbacks } } })}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-edge bg-surface-base p-5">
        <h2 className="text-base font-semibold text-fg">{zh ? '图片能力' : 'Image capabilities'}</h2>
        <p className="mt-1 text-sm text-fg-muted">{zh ? '没有图片任务时可以保持关闭。' : 'Leave these off when the agents do not work with images.'}</p>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-fg-muted">{zh ? '图片理解模型' : 'Image understanding model'}</label>
            <ModelSelector
              value={draft.models.imageUnderstanding?.primary ?? ''}
              placeholder={zh ? '关闭图片理解' : 'Image understanding off'}
              searchPlaceholder={zh ? '搜索视觉模型' : 'Search vision models'}
              noMatches={zh ? '没有可用的视觉模型' : 'No vision models available'}
              capabilitiesFilter="vision"
              allowEmpty
              emptyLabel={zh ? '关闭图片理解' : 'Image understanding off'}
              contentAlign="start"
              className="mt-2 w-full"
              ariaLabel={zh ? '图片理解模型' : 'Image understanding model'}
              onChange={(primary) => {
                const next = { ...draft.models };
                if (primary) next.imageUnderstanding = updateRoute(next.imageUnderstanding, primary);
                else delete next.imageUnderstanding;
                setDraft({ ...draft, models: next });
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-muted">{zh ? '图片生成模型' : 'Image generation model'}</label>
            <ModelSelector
              value={draft.models.imageGeneration?.primary ?? ''}
              models={imageModels}
              modelsLoading={imageQuery.isLoading}
              modelsError={imageQuery.error}
              placeholder={zh ? '关闭图片生成' : 'Image generation off'}
              searchPlaceholder={zh ? '搜索图片模型或服务商' : 'Search image models or providers'}
              noMatches={zh ? '没有可用的图片生成模型' : 'No image generation models available'}
              allowEmpty
              emptyLabel={zh ? '关闭图片生成' : 'Image generation off'}
              contentAlign="start"
              className="mt-2 w-full"
              ariaLabel={zh ? '图片生成模型' : 'Image generation model'}
              onChange={(primary) => {
                const next = { ...draft.models };
                if (primary) next.imageGeneration = {
                  primary,
                  fallbacks: next.imageGeneration?.fallbacks ?? [],
                  timeoutMs: next.imageGeneration?.timeoutMs,
                  autoProviderFallback: next.imageGeneration?.autoProviderFallback ?? true,
                };
                else delete next.imageGeneration;
                setDraft({ ...draft, models: next });
              }}
            />
          </div>
        </div>
        {draft.models.imageGeneration ? (
          <div className="mt-5 grid gap-4 border-t border-edge pt-5 sm:grid-cols-2">
            <label className="block text-xs font-medium text-fg-muted">{zh ? '生成超时（毫秒）' : 'Generation timeout (ms)'}<input type="number" min={1} className={`${inputClass} mt-2`} value={draft.models.imageGeneration.timeoutMs ?? ''} onChange={(event) => setDraft({ ...draft, models: { ...draft.models, imageGeneration: { ...draft.models.imageGeneration!, timeoutMs: event.target.value ? Number(event.target.value) : undefined } } })} /></label>
            <div className="text-xs font-medium text-fg-muted"><span>{zh ? '服务商自动回退' : 'Automatic provider fallback'}</span><div className="mt-1.5 flex rounded-lg bg-surface-panel p-1">{([true, false] as const).map((enabled) => <Button key={String(enabled)} variant={draft.models.imageGeneration?.autoProviderFallback === enabled ? 'secondary' : 'ghost'} className="flex-1 py-1.5 text-xs" onClick={() => setDraft({ ...draft, models: { ...draft.models, imageGeneration: { ...draft.models.imageGeneration!, autoProviderFallback: enabled } } })}>{enabled ? (zh ? '开启' : 'On') : (zh ? '关闭' : 'Off')}</Button>)}</div></div>
          </div>
        ) : null}
      </section>

      <AgentDefaultsVoiceSummary zh={zh} />

      <section className="rounded-2xl border border-edge bg-surface-base p-5">
        <h2 className="text-base font-semibold text-fg">{zh ? '按任务选择模型' : 'Route by task'}</h2>
        <p className="mt-1 text-sm text-fg-muted">{zh ? '仅在确实需要不同模型时设置；否则保持“使用默认对话模型”。' : 'Set a route only when a task genuinely needs another model; otherwise keep the default.'}</p>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {INTENTS.map((intent) => (
            <div key={intent} className="rounded-xl border border-edge bg-surface-panel p-4">
              <div className="mb-3">
                <h3 className="text-sm font-medium text-fg">{copy[intent][0]}</h3>
                <p className="mt-0.5 text-xs text-fg-muted">{copy[intent][1]}</p>
              </div>
              <ModelSelector
                value={draft.models.intents[intent]?.primary ?? ''}
                placeholder={zh ? '使用默认对话模型' : 'Use default conversation model'}
                searchPlaceholder={zh ? '搜索模型或服务商' : 'Search models or providers'}
                noMatches={zh ? '没有匹配的模型' : 'No matching models'}
                allowEmpty
                emptyLabel={zh ? '使用默认对话模型' : 'Use default conversation model'}
                showProviderInTrigger={false}
                contentAlign="start"
                className="w-full"
                ariaLabel={zh ? `${copy[intent][0]}模型` : `${copy[intent][0]} model`}
                onChange={(model) => setIntent(intent, model)}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
