import useSWR from 'swr';

import { SettingsAdvancedSection } from '@/features/settings/settings-advanced-section';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import {
  CONFIGURED_MODELS_SWR_KEY,
  fetchConfiguredModelsCached,
} from '@/features/chat/api/registry-api';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { FallbackModels } from '@/features/settings/agents/fallback-models';
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

export function ModelExecutionSettingsFields({
  draft,
  setDraft,
  zh,
  capability,
}: {
  draft: AgentDefaults;
  setDraft: (draft: AgentDefaults) => void;
  zh: boolean;
  capability: 'chat' | 'vision' | 'image';
}) {
  const modelsQuery = useSWR(CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, { revalidateOnFocus: false });
  const models = modelsQuery.data ?? [];
  const copy = zh ? intentCopy.zh : intentCopy.en;

  const setIntent = (intent: ModelIntent, model: string) => {
    const intents = { ...draft.models.intents };
    if (model) intents[intent] = updateRoute(intents[intent], model);
    else delete intents[intent];
    setDraft({ ...draft, models: { ...draft.models, intents } });
  };

  return (
    <div className="space-y-5">
      {capability === 'chat' ? <section className="rounded-xl bg-surface-hover/20 p-5">
        <SettingsAdvancedSection title={zh ? "模型回退" : "Model fallbacks"} summary={zh ? `已配置 ${draft.models.chat.fallbacks.length} 个备用模型。` : `${draft.models.chat.fallbacks.length} fallback models configured.`}>
          <div className="mt-6 rounded-xl bg-surface-base/45 p-4">
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
        </SettingsAdvancedSection>
      </section> : null}

      {capability === 'image' ? <section className="rounded-xl bg-surface-hover/20 p-5">
        {draft.models.imageGeneration ? (
          <SettingsAdvancedSection title={zh ? "图片执行策略" : "Image execution policy"} summary={zh ? "当前超时与回退策略继续生效。" : "The current timeout and fallback policy remains active."}>

            <div className="mt-5 grid gap-4 rounded-xl bg-surface-base/45 p-4 sm:grid-cols-2">
              <label className="block text-xs font-medium text-fg-muted">{zh ? '生成超时（毫秒）' : 'Generation timeout (ms)'}<NumberInput allowEmpty type="number" min={1} className={`${inputClass} mt-2`} value={draft.models.imageGeneration.timeoutMs ?? ''} onChange={(event) => setDraft({ ...draft, models: { ...draft.models, imageGeneration: { ...draft.models.imageGeneration!, timeoutMs: event.target.value ? Number(event.target.value) : undefined } } })} /></label>
              <div className="text-xs font-medium text-fg-muted"><span>{zh ? '服务商自动回退' : 'Automatic provider fallback'}</span><div className="mt-1.5 flex rounded-lg bg-surface-panel p-1">{([true, false] as const).map((enabled) => <Button key={String(enabled)} variant={draft.models.imageGeneration?.autoProviderFallback === enabled ? 'secondary' : 'ghost'} className="flex-1 py-1.5 text-xs" onClick={() => setDraft({ ...draft, models: { ...draft.models, imageGeneration: { ...draft.models.imageGeneration!, autoProviderFallback: enabled } } })}>{enabled ? (zh ? '开启' : 'On') : (zh ? '关闭' : 'Off')}</Button>)}</div></div>
            </div>

          </SettingsAdvancedSection>
        ) : null}
      </section> : null}

      {capability === 'vision' && draft.models.imageUnderstanding ? <SettingsAdvancedSection title={zh ? '模型回退' : 'Model fallbacks'} summary={zh ? '主模型不可用时使用已配置的备用模型。' : 'Use configured fallback models when the primary is unavailable.'}>
        <FallbackModels primary={draft.models.imageUnderstanding.primary} value={draft.models.imageUnderstanding.fallbacks} models={models.filter(model => model.vision)} loading={modelsQuery.isLoading} error={modelsQuery.error} zh={zh} onChange={fallbacks => setDraft({ ...draft, models: { ...draft.models, imageUnderstanding: { ...draft.models.imageUnderstanding!, fallbacks } } })} />
      </SettingsAdvancedSection> : null}

      {capability === 'chat' ? <SettingsAdvancedSection title={zh ? "任务模型路由" : "Task model routing"} summary={zh ? `已配置 ${Object.keys(draft.models.intents).length} 类任务路由；其他任务使用默认模型。` : `${Object.keys(draft.models.intents).length} task routes configured; other tasks use the default model.`}>
        <section className="rounded-xl bg-surface-hover/20 p-5">
          <h2 className="text-base font-semibold text-fg">{zh ? '按任务选择模型' : 'Route by task'}</h2>
          <p className="mt-1 text-sm text-fg-muted">{zh ? '仅在确实需要不同模型时设置；否则保持“使用默认对话模型”。' : 'Set a route only when a task genuinely needs another model; otherwise keep the default.'}</p>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {INTENTS.map((intent) => (
              <div key={intent} className="rounded-xl bg-surface-base/55 p-4">
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
      </SettingsAdvancedSection> : null}
    </div>
  );
}
