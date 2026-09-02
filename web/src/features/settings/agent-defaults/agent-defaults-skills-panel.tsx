import { CheckCircle2, ListChecks, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { getSkills } from '@/features/skills/skill-list-api';
import type { SkillCatalogEntry } from '@/features/skills/skill.types';
import type { AgentDefaults } from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function AgentDefaultsSkillsPanel({
  draft,
  setDraft,
  zh,
}: {
  draft: AgentDefaults;
  setDraft: (draft: AgentDefaults) => void;
  zh: boolean;
}) {
  const { data, error, isLoading } = useSWR('agent-defaults-skills-catalog', getSkills, { revalidateOnFocus: false });
  const [query, setQuery] = useState('');
  const configuredIds = draft.skills.mode === 'selected' ? draft.skills.include : draft.skills.exclude;
  const skills = useMemo(() => {
    const catalog = [...(data?.catalog ?? [])];
    const known = new Set(catalog.map((skill) => skill.name));
    for (const name of configuredIds) {
      if (!known.has(name)) catalog.push({ name, description: '', enabled: true } as SkillCatalogEntry);
    }
    const normalizedQuery = query.trim().toLowerCase();
    return catalog
      .filter((skill) => !normalizedQuery || `${skill.name} ${skill.description}`.toLowerCase().includes(normalizedQuery))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [configuredIds, data?.catalog, query]);

  const isIncluded = (name: string) => draft.skills.mode === 'selected'
    ? draft.skills.include.includes(name)
    : !draft.skills.exclude.includes(name);

  const toggleSkill = (name: string) => {
    if (draft.skills.mode === 'selected') {
      const include = draft.skills.include.includes(name)
        ? draft.skills.include.filter((item) => item !== name)
        : unique([...draft.skills.include, name]);
      setDraft({ ...draft, skills: { mode: 'selected', include } });
      return;
    }
    const exclude = draft.skills.exclude.includes(name)
      ? draft.skills.exclude.filter((item) => item !== name)
      : unique([...draft.skills.exclude, name]);
    setDraft({ ...draft, skills: { mode: 'all-enabled', exclude } });
  };

  const selectedCount = (data?.catalog ?? []).filter((skill) => skill.enabled && isIncluded(skill.name)).length;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-edge bg-surface-base p-5">
        <h2 className="text-base font-semibold text-fg">{zh ? '技能策略' : 'Skill policy'}</h2>
        <p className="mt-1 text-sm text-fg-muted">{zh ? '决定所有 Agent 默认可以发现和使用哪些技能。' : 'Choose which skills every agent can discover and use by default.'}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setDraft({ ...draft, skills: { mode: 'all-enabled', exclude: [] } })} className={cn('flex items-start gap-3 rounded-xl border p-4 text-left', draft.skills.mode === 'all-enabled' ? 'border-accent bg-accent/5 ring-1 ring-accent/20' : 'border-edge bg-surface-panel hover:border-edge-strong')}>
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" />
            <span><span className="block text-sm font-medium text-fg">{zh ? '使用所有已启用技能' : 'Use every enabled skill'}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{zh ? '推荐。以后启用的新技能也会自动可用，可单独排除。' : 'Recommended. Newly enabled skills become available automatically; exclude exceptions below.'}</span></span>
          </button>
          <button type="button" onClick={() => setDraft({ ...draft, skills: { mode: 'selected', include: [] } })} className={cn('flex items-start gap-3 rounded-xl border p-4 text-left', draft.skills.mode === 'selected' ? 'border-accent bg-accent/5 ring-1 ring-accent/20' : 'border-edge bg-surface-panel hover:border-edge-strong')}>
            <ListChecks className="mt-0.5 size-5 shrink-0 text-accent" />
            <span><span className="block text-sm font-medium text-fg">{zh ? '只使用选中的技能' : 'Use selected skills only'}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{zh ? '适合严格受控的环境；新增技能不会自动加入。' : 'For tightly controlled environments; new skills are not added automatically.'}</span></span>
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-edge bg-surface-base p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-base font-semibold text-fg">{draft.skills.mode === 'selected' ? (zh ? '选择可用技能' : 'Select available skills') : (zh ? '管理例外' : 'Manage exceptions')}</h2><p className="mt-1 text-sm text-fg-muted">{zh ? `当前默认可用 ${selectedCount} 个技能。` : `${selectedCount} skills are available by default.`}</p></div>
          <label className="relative block w-full sm:w-72"><span className="sr-only">{zh ? '搜索技能' : 'Search skills'}</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索技能' : 'Search skills'} className="w-full rounded-lg border border-edge bg-surface-panel py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-accent" /></label>
        </div>
        {error ? <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error instanceof Error ? error.message : String(error)}</p> : null}
        {isLoading ? <div className="mt-4 space-y-2">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-14 rounded-xl" />)}</div> : (
          <div className="mt-4 max-h-[32rem] divide-y divide-edge overflow-y-auto rounded-xl border border-edge bg-surface-panel">
            {skills.map((skill) => {
              const checked = isIncluded(skill.name);
              return (
                <label key={skill.name} className={cn('flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-hover/60', !skill.enabled && 'cursor-not-allowed opacity-55')}>
                  <input type="checkbox" checked={checked} disabled={!skill.enabled} onChange={() => toggleSkill(skill.name)} className="mt-0.5 size-4 rounded border-edge accent-[var(--color-accent)]" />
                  <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-fg">{skill.name}</span>{!skill.enabled ? <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-fg-muted">{zh ? '全局未启用' : 'Disabled globally'}</span> : null}</span>{skill.description ? <span className="mt-1 block line-clamp-2 text-xs leading-5 text-fg-muted">{skill.description}</span> : null}</span>
                </label>
              );
            })}
            {skills.length === 0 ? <p className="px-4 py-8 text-center text-sm text-fg-muted">{zh ? '没有匹配的技能。' : 'No matching skills.'}</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}
