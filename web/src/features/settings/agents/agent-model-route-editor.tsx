import { useMemo } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, type ConfiguredModel } from '@/features/chat/api/registry-api';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { FallbackModels } from '@/features/settings/agents/fallback-models';
import { fetchImageCatalog } from '@/features/settings/image-generation-api';
import type { ModelRoute } from '@/features/settings/types/agent-gateway';

function InheritedBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">{children}</span>;
}

export function ModelRouteEditor({
  label,
  inherited,
  value,
  zh,
  allowChatFallback = false,
  allowDisabled = false,
  modelKind = 'text',
  onChange,
}: {
  label: string;
  inherited?: ModelRoute;
  value: ModelRoute | null | undefined;
  zh: boolean;
  allowChatFallback?: boolean;
  allowDisabled?: boolean;
  modelKind?: 'text' | 'vision' | 'image';
  onChange: (value: ModelRoute | null | undefined) => void;
}) {
  const customized = value !== undefined && value !== null;
  const modelsQuery = useSWR(customized && modelKind !== 'image' ? CONFIGURED_MODELS_SWR_KEY : null, fetchConfiguredModelsCached, { revalidateOnFocus: false });
  const imageQuery = useSWR(customized && modelKind === 'image' ? 'agent-defaults-image-models' : null, fetchImageCatalog, { revalidateOnFocus: false });
  const imageModels = useMemo<ConfiguredModel[]>(
    () => (imageQuery.data ?? []).flatMap((provider) => provider.models.map((model) => ({
      id: `${provider.id}/${model}`,
      name: model,
      provider: provider.label,
    }))),
    [imageQuery.data],
  );
  const models = modelKind === 'image' ? imageModels : modelsQuery.data ?? [];
  const candidates = modelKind === 'vision' ? models.filter((model) => model.vision) : models;
  const query = modelKind === 'image' ? imageQuery : modelsQuery;
  return (
    <div className="rounded-2xl border border-edge bg-surface-base p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-fg">{label}</h4>
            {value === undefined ? <InheritedBadge>{zh ? '继承' : 'Inherited'}</InheritedBadge> : null}
            {value === null ? <InheritedBadge>{allowDisabled ? (zh ? '已禁用' : 'Disabled') : (zh ? '使用 Chat' : 'Uses Chat')}</InheritedBadge> : null}
          </div>
          {value === undefined ? <p className="mt-1 truncate font-mono text-xs text-fg-muted">{inherited?.primary ?? (zh ? '全局未配置' : 'Not configured globally')}</p> : null}
        </div>
        <div className="flex gap-1">
          {value !== undefined ? <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange(undefined)}>{zh ? '继承' : 'Inherit'}</Button> : null}
          {allowChatFallback && value !== null ? <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange(null)}>{zh ? '使用 Chat' : 'Use Chat'}</Button> : null}
          {allowDisabled && value !== null ? <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange(null)}>{zh ? '禁用' : 'Disable'}</Button> : null}
          {!customized ? <Button className="px-2 py-1 text-xs" onClick={() => onChange({ primary: inherited?.primary ?? '', fallbacks: [...(inherited?.fallbacks ?? [])] })}>{zh ? '自定义' : 'Customize'}</Button> : null}
        </div>
      </div>
      {customized ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
          <div>
            <p className="text-xs font-medium text-fg-muted">{zh ? '主模型' : 'Primary model'}</p>
            {query.isLoading ? <Skeleton className="mt-1.5 h-11 w-full rounded-lg" /> : <ModelSelector
              value={value.primary}
              models={models}
              modelsLoading={query.isLoading}
              modelsError={query.error}
              capabilitiesFilter={modelKind === 'vision' ? 'vision' : undefined}
              placeholder={zh ? '选择模型' : 'Select a model'}
              searchPlaceholder={zh ? '搜索模型或服务商' : 'Search models or providers'}
              noMatches={zh ? '没有匹配的模型' : 'No matching models'}
              contentAlign="start"
              className="mt-1.5 w-full"
              ariaLabel={zh ? `${label}主模型` : `${label} primary model`}
              onChange={(primary) => onChange({ ...value, primary })}
            />}
          </div>
          <FallbackModels
            primary={value.primary}
            value={value.fallbacks}
            models={candidates}
            loading={query.isLoading}
            error={query.error}
            zh={zh}
            onChange={(fallbacks) => onChange({ ...value, fallbacks })}
          />
        </div>
      ) : null}
    </div>
  );
}

