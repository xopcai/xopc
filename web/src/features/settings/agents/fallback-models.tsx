import { X } from 'lucide-react';
import { useMemo } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import { ModelSelector } from '@/features/chat/model/model-selector';

export function FallbackModels({
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
            <span key={model} className="inline-flex items-center gap-2 rounded-full bg-surface-base/70 py-1 pl-2.5 pr-1 text-xs text-fg">
              <span className="text-fg-subtle">{index + 1}</span>
              <span>{models.find((candidate) => candidate.id === model)?.name ?? model}</span>
              <button type="button" aria-label={zh ? `移除 ${model}` : `Remove ${model}`} className="rounded-full p-1 text-fg-muted hover:bg-surface-hover hover:text-fg" onClick={() => onChange(value.filter((item) => item !== model))}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      ) : <p className="mt-3 text-xs text-fg-subtle">{zh ? '未设置回退模型。' : 'No fallback models configured.'}</p>}
      {loading ? <Skeleton className="mt-3 h-11 w-full max-w-md rounded-lg" /> : <ModelSelector
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
      />}
    </div>
  );
}

