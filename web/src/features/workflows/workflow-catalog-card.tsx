import { Eye, Play, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition } from './workflow-api';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';
import { interpolate } from './workflow-page.utils';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

function agentScaleLabel(definition: WorkflowDefinition, labels: WorkflowsMessages): string | null {
  const est = definition.metadata.estimatedAgents;
  if (!est) return null;
  if (est.min === est.max) {
    return interpolate(labels.agentScaleExact, { count: est.min });
  }
  return interpolate(labels.agentScaleRange, { min: est.min, max: est.max });
}

export function WorkflowCatalogCard({
  definition,
  language,
  onRun,
  onDetail,
  onDelete,
}: {
  definition: WorkflowDefinition;
  language: StoredLanguage;
  onRun: () => void;
  onDetail: () => void;
  onDelete?: () => void;
}) {
  const labels = messages(language).workflows;
  const localized = resolveWorkflowLocalizedCopy(definition, language);
  const scale = agentScaleLabel(definition, labels);
  const isUser = definition.metadata.source === 'user';

  return (
    <article className="flex h-full flex-col rounded-2xl border border-edge bg-surface-panel p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-fg">{definition.title}</h3>
            <p className="mt-0.5 font-mono text-[11px] text-fg-subtle">{definition.name}</p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
              isUser ? 'bg-accent-soft text-accent-fg' : 'bg-surface-hover text-fg-muted',
            )}
          >
            {isUser ? labels.badgeUser : labels.badgeBuiltin}
          </span>
        </div>

        <p className="mt-3 line-clamp-2 text-xs leading-5 text-fg-muted">{localized.description}</p>
        {localized.whenToUse ? (
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-fg-subtle">{localized.whenToUse}</p>
        ) : null}

        {definition.phases.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {definition.phases.slice(0, 4).map((phase) => (
              <span key={phase.id} className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] text-fg-muted">
                {phase.title}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {scale ? (
            <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] text-fg-muted">{scale}</span>
          ) : null}
          {definition.metadata.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] text-fg-muted">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" className="flex-1" onClick={onRun}>
          <Play className="size-4" aria-hidden />
          {labels.runWorkflow}
        </Button>
        <Button variant="secondary" onClick={onDetail}>
          <Eye className="size-4" aria-hidden />
          {labels.viewDetails}
        </Button>
        {onDelete ? (
          <Button variant="secondary" onClick={onDelete} className="text-red-600 dark:text-red-300">
            <Trash2 className="size-4" aria-hidden />
            {labels.deleteWorkflow}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
