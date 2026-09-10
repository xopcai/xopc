import { Gauge, Puzzle, ShieldCheck, Sparkles } from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { AutosaveStatus } from '@/components/ui/autosave-status';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentDefaultsModelsPanel } from '@/features/settings/agent-defaults/agent-defaults-models-panel';
import { AgentDefaultsRuntimePanel } from '@/features/settings/agent-defaults/agent-defaults-runtime-panel';
import { AgentDefaultsSkillsPanel } from '@/features/settings/agent-defaults/agent-defaults-skills-panel';
import { AgentDefaultsToolsPanel } from '@/features/settings/agent-defaults/agent-defaults-tools-panel';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { fetchGlobalDefaults, updateGlobalDefaults } from '@/features/settings/global-defaults-api';
import type { AgentDefaults, BuiltinToolSummary } from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';
import { useAutosave } from '@/lib/use-autosave';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type DefaultsPanel = 'models' | 'skills' | 'tools' | 'runtime';

function DefaultsSkeleton() {
  return (
    <SettingsPageFrame gap="gap-5">
      <div className="flex items-center justify-between"><div className="space-y-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-96 max-w-full" /></div><Skeleton className="h-9 w-28" /></div>
      <Skeleton className="h-20 rounded-2xl" />
      <Skeleton className="h-12 rounded-xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </SettingsPageFrame>
  );
}

function AgentDefaultsEditor({
  initial,
  builtinTools,
  zh,
}: {
  initial: AgentDefaults;
  builtinTools: BuiltinToolSummary[];
  zh: boolean;
}) {
  const [activePanel, setActivePanel] = useState<DefaultsPanel>('models');
  const [draft, setDraft] = useState<AgentDefaults>(() => structuredClone(initial));
  const [saved, setSaved] = useState<AgentDefaults>(() => structuredClone(initial));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const tabs: Array<{ id: DefaultsPanel; label: string; icon: typeof Sparkles }> = [
    { id: 'models', label: zh ? '模型' : 'Models', icon: Sparkles },
    { id: 'skills', label: zh ? '技能' : 'Skills', icon: Puzzle },
    { id: 'tools', label: zh ? '工具' : 'Tools', icon: ShieldCheck },
    { id: 'runtime', label: zh ? '运行' : 'Runtime', icon: Gauge },
  ];

  const save = useCallback(async (snapshot: AgentDefaults) => {
    const submitted = structuredClone(snapshot);
    const next = await updateGlobalDefaults(submitted);
    const normalized = structuredClone(next.defaults);
    setDraft((current) => JSON.stringify(current) === JSON.stringify(submitted) ? normalized : current);
    setSaved(structuredClone(normalized));
  }, []);

  const autosave = useAutosave({ value: draft, dirty, onSave: save, delayMs: 0 });

  return (
    <SettingsPageFrame gap="gap-5" onBlurCapture={autosave.onBlurCapture}>
      <SettingsPageHeader
        title={zh ? '智能体设置' : 'Agent settings'}
        actions={(
          <AutosaveStatus status={autosave.status} error={autosave.error} />
        )}
      />

      {autosave.error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">
          <span>{autosave.error}</span>
          <Button type="button" variant="ghost" className="h-8 text-red-600" onClick={autosave.retry}>
            {zh ? '重试' : 'Retry'}
          </Button>
        </div>
      ) : null}

      <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-edge bg-surface-base p-2 lg:grid-cols-4" aria-label={zh ? '默认配置分区' : 'Default configuration sections'}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={activePanel === id} onClick={() => setActivePanel(id)} className={cn('flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors', activePanel === id ? 'bg-surface-panel text-fg shadow-surface ring-1 ring-edge' : 'text-fg-muted hover:bg-surface-hover hover:text-fg')}>
            <Icon className={cn('size-4 shrink-0', activePanel === id ? 'text-accent' : 'text-fg-subtle')} />
            <span className="text-sm font-medium">{label}</span>
          </button>
        ))}
      </nav>

      {activePanel === 'models' ? <AgentDefaultsModelsPanel draft={draft} setDraft={setDraft} zh={zh} /> : null}
      {activePanel === 'skills' ? <AgentDefaultsSkillsPanel draft={draft} setDraft={setDraft} zh={zh} /> : null}
      {activePanel === 'tools' ? <AgentDefaultsToolsPanel draft={draft} setDraft={setDraft} builtinTools={builtinTools} zh={zh} /> : null}
      {activePanel === 'runtime' ? <AgentDefaultsRuntimePanel draft={draft} setDraft={setDraft} zh={zh} /> : null}
    </SettingsPageFrame>
  );
}

export function AgentDefaultsSettingsPanel() {
  const token = useGatewayStore((state) => state.token);
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const { data, error, isLoading, mutate } = useSWR(token ? 'settings-agent-defaults' : null, fetchGlobalDefaults);

  if (!token) return <SettingsPageFrame><p className="text-sm text-fg-muted">{zh ? '需要本机服务令牌。' : 'Local service token required.'}</p></SettingsPageFrame>;
  if (error && !data) return <SettingsPageFrame><p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{String(error)}</p><Button onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></SettingsPageFrame>;
  if (isLoading || !data) return <DefaultsSkeleton />;

  return <AgentDefaultsEditor initial={data.defaults} builtinTools={data.builtinTools} zh={zh} />;
}
