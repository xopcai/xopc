import { ChevronDown, Layers3, SlidersHorizontal, Target, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition } from './workflow-api';
import {
  summarizeWorkflowInput,
  WorkflowInputEditor,
  type WorkflowInputEditorAiAssistConfig,
  type WorkflowInputEditorValidity,
  type WorkflowInputEditorValue,
} from './workflow-input-editor';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';
import { interpolate } from './workflow-page.utils';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

export interface WorkflowRunSetupValue extends WorkflowInputEditorValue {
  concurrency: string;
  maxSubagents: string;
  timeoutSeconds?: string;
}

function agentScaleLabel(definition: WorkflowDefinition, labels: WorkflowsMessages): string {
  const estimatedAgents = definition.metadata.estimatedAgents;
  if (!estimatedAgents) {
    return interpolate(labels.agentScaleExact, { count: definition.defaults.maxSubagents });
  }
  if (estimatedAgents.min === estimatedAgents.max) {
    return interpolate(labels.agentScaleExact, { count: estimatedAgents.min });
  }
  return interpolate(labels.agentScaleRange, {
    min: estimatedAgents.min,
    max: estimatedAgents.max,
  });
}

export function WorkflowRunSetupPanel({
  definition,
  language,
  value,
  onChange,
  mode,
  badgeLabel,
  aiAssist,
  inputClassName,
  showTimeout = false,
  defaultAdvancedOpen = false,
  onValidityChange,
}: {
  definition: WorkflowDefinition;
  language: StoredLanguage;
  value: WorkflowRunSetupValue;
  onChange: (next: WorkflowRunSetupValue) => void;
  mode: 'manual' | 'automation';
  badgeLabel?: string;
  aiAssist?: WorkflowInputEditorAiAssistConfig;
  inputClassName?: string;
  showTimeout?: boolean;
  defaultAdvancedOpen?: boolean;
  onValidityChange?: (validity: WorkflowInputEditorValidity) => void;
}) {
  const labels = messages(language).workflows;
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen);
  const localized = useMemo(
    () => resolveWorkflowLocalizedCopy(definition, language),
    [definition, language],
  );
  const effectiveConcurrency = value.concurrency.trim()
    ? Number(value.concurrency)
    : definition.defaults.concurrency;
  const effectiveMaxSubagents = value.maxSubagents.trim()
    ? Number(value.maxSubagents)
    : definition.defaults.maxSubagents;
  const inputSummary = summarizeWorkflowInput(definition, language, value);
  const resolvedBadge = badgeLabel ?? labels.readyToStart;

  const update = (patch: Partial<WorkflowRunSetupValue>) => onChange({ ...value, ...patch });

  return (
    <div className={cn('space-y-4', mode === 'automation' && 'rounded-xl bg-surface-panel/70 p-3 shadow-surface')}>
      <section className="rounded-2xl bg-surface-panel p-4 shadow-surface">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-fg">{labels.runPlanPreview}</h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{inputSummary || localized.description}</p>
          </div>
          <span className="shrink-0 rounded-full bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent-fg">
            {resolvedBadge}
          </span>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-fg-muted sm:grid-cols-3">
          <div className="flex items-center gap-2 rounded-xl bg-surface-panel px-2.5 py-2">
            <Layers3 className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span>{interpolate(labels.phaseCount, { count: definition.phases.length })}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-surface-panel px-2.5 py-2">
            <UsersRound className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span>{agentScaleLabel(definition, labels)}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-surface-panel px-2.5 py-2">
            <SlidersHorizontal className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span>
              {interpolate(labels.runLimitsSummary, {
                concurrency: effectiveConcurrency,
                max: effectiveMaxSubagents,
              })}
            </span>
          </div>
        </div>

        {definition.phases.length > 0 ? (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              <Target className="size-3.5" aria-hidden />
              {labels.startPlanPhases}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {definition.phases.map((phase, index) => (
                <div key={phase.id} className="flex items-center gap-1.5">
                  {index > 0 ? <span className="text-fg-subtle">→</span> : null}
                  <span className="rounded-lg border border-edge-subtle bg-surface-panel px-2 py-1 text-[11px] text-fg-muted">
                    {phase.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <WorkflowInputEditor
        definition={definition}
        language={language}
        value={value}
        onChange={(next) => onChange({ ...value, ...next })}
        onValidityChange={(validity) => {
          onValidityChange?.(validity);
        }}
        aiAssist={aiAssist}
        inputClassName={inputClassName}
      />

      <div className="rounded-xl border border-edge">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-fg"
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          {labels.advancedSettings}
          <ChevronDown className={cn('size-4 transition-transform', advancedOpen && 'rotate-180')} />
        </button>
        {advancedOpen ? (
          <div className="grid gap-3 border-t border-edge px-3 pb-3 pt-3 sm:grid-cols-2">
            <input
              value={value.concurrency}
              onChange={(event) => update({ concurrency: event.target.value })}
              placeholder={interpolate(labels.concurrencyPlaceholder, {
                default: definition.defaults.concurrency,
              })}
              inputMode="numeric"
              className="rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <input
              value={value.maxSubagents}
              onChange={(event) => update({ maxSubagents: event.target.value })}
              placeholder={interpolate(labels.maxSubagentsPlaceholder, {
                default: definition.defaults.maxSubagents,
              })}
              inputMode="numeric"
              className="rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {showTimeout ? (
              <input
                value={value.timeoutSeconds ?? ''}
                onChange={(event) => update({ timeoutSeconds: event.target.value })}
                placeholder={interpolate(labels.timeoutSecondsPlaceholder, {
                  default: definition.defaults.timeoutSec,
                })}
                inputMode="numeric"
                className="rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
