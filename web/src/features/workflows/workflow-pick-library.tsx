import { Braces, CopyPlus, Layers3, Pencil, Play, Search, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition, WorkflowRunSummary } from './workflow-api';
import { formatRelativeTime } from './workflow-board.utils';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';
import {
  WORKFLOW_CATEGORY_FILTERS,
  WORKFLOW_SOURCE_FILTERS,
  type WorkflowCategoryFilter,
  type WorkflowSourceFilter,
} from './workflow-page.constants';
import { filterDefinitions, interpolate } from './workflow-page.utils';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

function agentScaleLabel(definition: WorkflowDefinition, labels: WorkflowsMessages): string | null {
  const est = definition.metadata.estimatedAgents;
  if (!est) return null;
  if (est.min === est.max) return interpolate(labels.agentScaleExact, { count: est.min });
  return interpolate(labels.agentScaleRange, { min: est.min, max: est.max });
}

function WorkflowLibraryCard({
  definition,
  language,
  labels,
  onPick,
  onDetail,
  onEdit,
}: {
  definition: WorkflowDefinition;
  language: StoredLanguage;
  labels: WorkflowsMessages;
  onPick: (definition: WorkflowDefinition) => void;
  onDetail: (definition: WorkflowDefinition) => void;
  onEdit: (definition: WorkflowDefinition) => void;
}) {
  const localized = resolveWorkflowLocalizedCopy(definition, language);
  const scale = agentScaleLabel(definition, labels);
  const isUser = definition.metadata.source === 'user';

  return (
    <article className="flex min-h-48 flex-col rounded-xl border border-edge-subtle bg-surface-base p-4 transition-colors hover:border-edge hover:bg-surface-hover/35">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium',
              isUser ? 'bg-accent-soft text-accent-fg' : 'bg-surface-muted text-fg-muted',
            )}>
              {isUser ? labels.badgeUser : labels.badgeBuiltin}
            </span>
            {definition.inputSchema ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-fg-subtle">
                <Braces className="size-2.5" aria-hidden />
                {labels.inputSchemaBadge}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className={cn('mt-2 line-clamp-2 text-left text-sm font-semibold leading-5 text-fg hover:text-accent-fg', interaction.focusRingPanel)}
            onClick={() => onDetail(definition)}
          >
            {definition.title}
          </button>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="size-8 shrink-0 p-0"
          aria-label={`${isUser ? labels.editWorkflow : labels.copyAndEditWorkflow}: ${definition.title}`}
          onClick={() => onEdit(definition)}
        >
          {isUser ? <Pencil className="size-3.5" aria-hidden /> : <CopyPlus className="size-3.5" aria-hidden />}
        </Button>
      </div>

      <p className="mt-2 line-clamp-2 text-xs leading-5 text-fg-muted">
        {localized.whenToUse || localized.description || definition.description}
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-3 pt-4 text-[11px] text-fg-subtle">
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

      <div className="mt-3 flex items-center gap-2 border-t border-edge-subtle pt-3">
        <Button type="button" variant="primary" className="h-8 flex-1 rounded-lg text-xs" onClick={() => onPick(definition)}>
          <Play className="size-3.5" aria-hidden />
          {labels.configureAndRun}
        </Button>
        <Button type="button" variant="secondary" className="h-8 rounded-lg text-xs" onClick={() => onDetail(definition)}>
          {labels.viewDetails}
        </Button>
      </div>
    </article>
  );
}

export function WorkflowPickLibrary({
  definitions,
  runs,
  language,
  onPick,
  onDetail,
  onEdit,
}: {
  definitions: WorkflowDefinition[];
  runs: WorkflowRunSummary[];
  language: StoredLanguage;
  onPick: (definition: WorkflowDefinition) => void;
  onDetail: (definition: WorkflowDefinition) => void;
  onEdit: (definition: WorkflowDefinition) => void;
}) {
  const labels = messages(language).workflows;
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<WorkflowCategoryFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<WorkflowSourceFilter>('all');

  const filtered = useMemo(
    () => filterDefinitions(definitions, query, categoryFilter, sourceFilter),
    [categoryFilter, definitions, query, sourceFilter],
  );
  const recentDefinitions = useMemo(() => {
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const seen = new Set<string>();
    return [...runs]
      .sort((a, b) => (b.startedAtMs ?? b.createdAtMs) - (a.startedAtMs ?? a.createdAtMs))
      .flatMap((run) => {
        if (seen.has(run.definitionId)) return [];
        const definition = byId.get(run.definitionId);
        if (!definition) return [];
        seen.add(run.definitionId);
        return [{ definition, lastRunAtMs: run.startedAtMs ?? run.createdAtMs }];
      })
      .slice(0, 3);
  }, [definitions, runs]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {recentDefinitions.length > 0 && !query && categoryFilter === 'all' && sourceFilter === 'all' ? (
        <section aria-labelledby="recent-workflows-heading">
          <h2 id="recent-workflows-heading" className="text-sm font-semibold text-fg">{labels.recentlyUsed}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {recentDefinitions.map(({ definition, lastRunAtMs }) => (
              <button
                key={definition.id}
                type="button"
                className={cn(
                  'flex min-w-52 flex-1 items-center justify-between gap-3 rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 text-left hover:bg-surface-hover',
                  'sm:max-w-sm',
                  interaction.focusRingPanel,
                )}
                onClick={() => onPick(definition)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{definition.title}</span>
                  <span className="mt-0.5 block text-[11px] text-fg-subtle">{formatRelativeTime(lastRunAtMs, Date.now(), localeTag)}</span>
                </span>
                <Play className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="all-workflows-heading">
        <div className="flex flex-col gap-3 border-b border-edge-subtle pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="all-workflows-heading" className="text-sm font-semibold text-fg">{labels.allWorkflows}</h2>
              <p className="mt-1 text-xs text-fg-muted">{interpolate(labels.workflowCount, { count: filtered.length })}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg bg-surface-muted p-0.5" role="group" aria-label={labels.sourceFilterAria}>
                {WORKFLOW_SOURCE_FILTERS.map((source) => (
                  <button
                    key={source}
                    type="button"
                    className={cn(
                      'h-8 rounded-md px-2.5 text-xs font-medium transition-colors',
                      sourceFilter === source ? 'bg-surface-base text-fg shadow-surface' : 'text-fg-muted hover:text-fg',
                      interaction.focusRingPanel,
                    )}
                    aria-pressed={sourceFilter === source}
                    onClick={() => setSourceFilter(source)}
                  >
                    {labels.sources[source]}
                  </button>
                ))}
              </div>
              <Select
                value={categoryFilter}
                aria-label={labels.categoryFilterAria}
                onChange={(event) => setCategoryFilter(event.target.value as WorkflowCategoryFilter)}
                className="h-9 min-w-36 rounded-lg border border-edge bg-surface-base px-2.5 text-xs font-medium text-fg shadow-surface"
              >
                {WORKFLOW_CATEGORY_FILTERS.map((category) => (
                  <SelectOption key={category} value={category}>{labels.categories[category]}</SelectOption>
                ))}
              </Select>
            </div>
          </div>

          <div className="relative max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.librarySearchPlaceholder}
              className={cn(
                'h-10 w-full rounded-lg border border-edge bg-surface-base py-2 pl-10 pr-3 text-sm text-fg',
                'placeholder:text-fg-muted',
                interaction.focusRingPanel,
              )}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-4 py-12 text-center">
            <p className="text-sm font-medium text-fg">{labels.noDefinitions}</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-fg-muted">{labels.noDefinitionsHint}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((definition) => (
              <WorkflowLibraryCard
                key={definition.id}
                definition={definition}
                language={language}
                labels={labels}
                onPick={onPick}
                onDetail={onDetail}
                onEdit={onEdit}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
