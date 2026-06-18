import { ArrowRight, Braces, Eye, Layers3, Play, ShieldCheck, Sparkles, Trash2, UsersRound } from 'lucide-react';

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

function phaseSummary(definition: WorkflowDefinition, labels: WorkflowsMessages): string {
  return interpolate(labels.phaseCount, { count: definition.phases.length });
}

function buildCapabilityChips(definition: WorkflowDefinition, labels: WorkflowsMessages): string[] {
  const chips: string[] = [];
  if (definition.inputSchema) chips.push(labels.inputSchemaBadge);
  if (definition.outputSchema) chips.push(labels.outputSchemaBadge);
  if (definition.permissions?.network) chips.push(`${labels.permissionsNetwork}: ${labels.networkEnabled}`);
  if (definition.permissions?.approvalRequired) chips.push(labels.permissionsApproval);
  return chips.slice(0, 3);
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
  const examplePrompt = localized.examplePrompts[0]?.text;
  const visiblePhases = definition.phases.slice(0, 3);
  const hiddenPhaseCount = Math.max(0, definition.phases.length - visiblePhases.length);
  const capabilityChips = buildCapabilityChips(definition, labels);

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-surface transition-colors hover:border-accent/40">
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  isUser ? 'bg-accent-soft text-accent-fg' : 'bg-surface-hover text-fg-muted',
                )}
              >
                {isUser ? labels.badgeUser : labels.badgeBuiltin}
              </span>
              {definition.version ? (
                <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-fg-subtle">
                  {interpolate(labels.versionLabel, { version: definition.version })}
                </span>
              ) : null}
              {definition.metadata.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-fg-subtle">
                  {tag}
                </span>
              ))}
            </div>
            <h3 className="line-clamp-2 text-base font-semibold leading-6 text-fg">{definition.title}</h3>
          </div>
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-fg opacity-70" aria-hidden />
        </div>

        <p className="mt-2 line-clamp-2 text-sm leading-5 text-fg-muted">{localized.description}</p>

        <div className="mt-4 rounded-xl border border-edge-subtle bg-surface-base/70 p-3">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            <ArrowRight className="size-3.5" aria-hidden />
            {labels.templateBestFor}
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-fg">
            {localized.whenToUse ?? localized.description}
          </p>
        </div>

        {capabilityChips.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {capabilityChips.map((chip) => (
              <span key={chip} className="inline-flex items-center gap-1 rounded-lg border border-edge-subtle bg-surface-base px-2 py-1 text-[11px] text-fg-muted">
                {chip === labels.inputSchemaBadge ? <Braces className="size-3" aria-hidden /> : <ShieldCheck className="size-3" aria-hidden />}
                {chip}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-4 grid gap-2 text-xs text-fg-muted sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-lg bg-surface-hover px-2.5 py-2">
            <Layers3 className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span>{phaseSummary(definition, labels)}</span>
          </div>
          {scale ? (
            <div className="flex items-center gap-2 rounded-lg bg-surface-hover px-2.5 py-2">
              <UsersRound className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
              <span>{scale}</span>
            </div>
          ) : null}
        </div>

        {visiblePhases.length > 0 ? (
          <div className="mt-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              {labels.templatePlan}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {visiblePhases.map((phase, index) => (
                <div key={phase.id} className="flex items-center gap-1.5">
                  {index > 0 ? <span className="text-fg-subtle">→</span> : null}
                  <span className="rounded-lg border border-edge-subtle bg-surface-base px-2 py-1 text-[11px] text-fg-muted">
                    {phase.title}
                  </span>
                </div>
              ))}
              {hiddenPhaseCount > 0 ? (
                <span className="rounded-lg bg-surface-hover px-2 py-1 text-[11px] text-fg-subtle">
                  {interpolate(labels.morePhases, { count: hiddenPhaseCount })}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {examplePrompt ? (
          <div className="mt-4 border-l-2 border-accent/40 pl-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              {labels.templateExample}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">“{examplePrompt}”</p>
          </div>
        ) : null}

        <p className="mt-4 font-mono text-[10px] text-fg-subtle">{definition.name}</p>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-edge-subtle bg-surface-base/60 p-3">
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
