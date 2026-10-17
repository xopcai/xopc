import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { fetchGlobalDefaults } from '@/features/settings/global-defaults-api';
import type { StoredLanguage } from '@/lib/storage';

export function WorkflowModelSelect({ value, language, onChange }: {
  value?: string;
  language: StoredLanguage;
  onChange: (model: string | undefined) => void;
}) {
  const config = useSWR('settings-agent-defaults', fetchGlobalDefaults);
  const globalModel = config.data?.defaults.models.chat.primary;
  const zh = language === 'zh';
  const defaultLabel = `${zh ? '全局默认模型' : 'Global default model'}${globalModel ? ` · ${globalModel}` : ''}`;
  if (config.isLoading) return <Skeleton className="mt-1 h-10 w-full rounded-lg" />;
  return <div className="mt-1">
    <ModelSelector
      value={value ?? ''}
      placeholder={defaultLabel}
      emptyLabel={defaultLabel}
      allowEmpty
      ariaLabel={zh ? '步骤模型' : 'Step model'}
      searchPlaceholder={zh ? '搜索模型' : 'Search models'}
      noMatches={zh ? '没有匹配的模型' : 'No matching models'}
      contentAlign="start"
      className="w-full"
      onChange={(model) => onChange(model || undefined)}
    />
    {config.error ? <p role="alert" className="mt-1 text-xs text-danger">{zh ? '无法加载全局默认模型' : 'Unable to load the global default model'}</p> : null}
  </div>;
}
