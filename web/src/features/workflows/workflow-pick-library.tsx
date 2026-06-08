import { Layers3, Play, Search, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition } from './workflow-api';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';
import { WORKFLOW_CATEGORY_FILTERS, type WorkflowCategoryFilter } from './workflow-page.constants';
import { filterDefinitions, groupDefinitionsByCategory, interpolate } from './workflow-page.utils';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

function agentScaleLabel(definition: WorkflowDefinition, labels: WorkflowsMessages): string | null {
  const est = definition.metadata.estimatedAgents;
  if (!est) return null;
  if (est.min === est.max) {
    return interpolate(labels.agentScaleExact, { count: est.min });
  }
  return interpolate(labels.agentScaleRange, { min: est.min, max: est.max });
}

function WorkflowPickCard({
  definition,
  language,
  labels,
  onPick,
}: {
  definition: WorkflowDefinition;
  language: StoredLanguage;
  labels: WorkflowsMessages;
  onPick: (definition: WorkflowDefinition) => void;
}) {
  const localized = resolveWorkflowLocalizedCopy(definition, language);
  const scale = agentScaleLabel(definition, labels);
  const isUser = definition.metadata.source === 'user';

  return (
    <button
      type="button"
      onClick={() => onPick(definition)}
      className={cn(
        'group flex h-full flex-col rounded-xl border border-edge-subtle bg-surface-base p-4 text-left transition-colors',
        'hover:border-accent/40 hover:bg-surface-hover',
        interaction.focusRingPanel,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                isUser ? 'bg-accent-soft text-accent-fg' : 'bg-surface-hover text-fg-muted',
              )}
            >
              {isUser ? labels.badgeUser : labels.badgeBuiltin}
            </span>
            {definition.metadata.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-fg-subtle">
                {tag}
              </span>
            ))}
          </div>
          <span className="line-clamp-2 text-sm font-semibold leading-5 text-fg">{definition.title}</span>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg opacity-80 transition-opacity group-hover:opacity-100">
          <Play className="size-3.5" aria-hidden />
        </span>
      </div>

      {localized.description ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-fg-muted">{localized.description}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-3 pt-3 text-[11px] text-fg-subtle">
        <span className="inline-flex items-center gap-1">
          <Layers3 className="size-3" aria-hidden />
          {interpolate(labels.phaseCount, { count: definition.phases.length })}
        </span>
        {scale ? (
          <span className="inline-flex items-center gap-1">
            <UsersRound className="size-3" aria-hidden />
            {scale}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function categoryLabel(
  category: Exclude<WorkflowCategoryFilter, 'all'> | 'uncategorized',
  labels: WorkflowsMessages,
): string {
  if (category === 'uncategorized') return labels.categories.uncategorized;
  return labels.categories[category];
}

export function WorkflowPickLibrary({
  definitions,
  language,
  onPick,
}: {
  definitions: WorkflowDefinition[];
  language: StoredLanguage;
  onPick: (definition: WorkflowDefinition) => void;
}) {
  const labels = messages(language).workflows;
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<WorkflowCategoryFilter>('all');

  const filtered = useMemo(
    () => filterDefinitions(definitions, query, categoryFilter, 'all'),
    [definitions, query, categoryFilter],
  );

  const grouped = useMemo(() => groupDefinitionsByCategory(filtered), [filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-col gap-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.searchPlaceholder}
            className={cn(
              'h-10 w-full rounded-xl border border-edge bg-surface-base py-2 pl-10 pr-3 text-sm text-fg',
              'placeholder:text-fg-subtle',
              interaction.focusRingPanel,
            )}
          />
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label={labels.categoryFilterAria}>
          {WORKFLOW_CATEGORY_FILTERS.map((category) => (
            <Button
              key={category}
              type="button"
              variant={categoryFilter === category ? 'secondary' : 'ghost'}
              className="h-8 rounded-full px-3 py-1.5 text-xs"
              onClick={() => setCategoryFilter(category)}
            >
              {labels.categories[category]}
            </Button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 py-12 text-center">
            <p className="text-sm text-fg-muted">{labels.noDefinitions}</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-fg-subtle">{labels.noDefinitionsHint}</p>
          </div>
        ) : categoryFilter === 'all' ? (
          <div className="flex flex-col gap-6 pb-1">
            {grouped.map((group) => (
              <section key={group.category}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                  {categoryLabel(group.category, labels)}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((definition) => (
                    <WorkflowPickCard
                      key={definition.id}
                      definition={definition}
                      language={language}
                      labels={labels}
                      onPick={onPick}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 pb-1 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((definition) => (
              <WorkflowPickCard
                key={definition.id}
                definition={definition}
                language={language}
                labels={labels}
                onPick={onPick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
