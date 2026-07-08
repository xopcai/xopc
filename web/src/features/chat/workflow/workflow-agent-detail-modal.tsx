/**
 * Modal detail view for a single workflow subagent.
 *
 * Layout: fixed header and status summary, scrollable transcript/prompt/logs body.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { PageTabs } from '@/components/ui/page-tabs';
import type { Message } from '@/features/chat/messages/messages.types';
import { ReadonlyMessageThread } from '@/features/chat/messages/readonly-message-thread';
import { getWorkflowAgentSession } from '@/features/workflows/workflow-api';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import type { WorkflowAgentSnapshot, WorkflowSnapshot } from './workflow.types';
import { formatAgentElapsed } from './workflow.utils';

export type WorkflowAgentDetailModalLabels = {
  close: string;
  statusQueued: string;
  statusRunning: string;
  statusDone: string;
  statusError: string;
  statusSkipped: string;
  workedFor: (duration: string) => string;
  statusHeading: string;
  phaseHeading: string;
  elapsedHeading: string;
  currentStepHeading: string;
  executionHeading: string;
  outputHeading: string;
  stepsHeading: string;
  transcriptHeading: string;
  promptHeading: string;
  logsHeading: string;
  runningPlaceholder: string;
};

type AgentDetailTab = 'output' | 'steps' | 'transcript' | 'prompt' | 'logs';

function statusLabel(agent: WorkflowAgentSnapshot, labels: WorkflowAgentDetailModalLabels): string {
  switch (agent.status) {
    case 'queued':
      return labels.statusQueued;
    case 'running':
      return labels.statusRunning;
    case 'done':
      return labels.statusDone;
    case 'error':
      return labels.statusError;
    case 'skipped':
      return labels.statusSkipped;
    default:
      return agent.status;
  }
}

function agentStatusTone(status: WorkflowAgentSnapshot['status']): string {
  if (status === 'done') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'error') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300';
  if (status === 'running') return 'bg-accent-soft text-accent-fg';
  return 'bg-surface-hover text-fg-subtle';
}

export const WorkflowAgentDetailModal = memo(function WorkflowAgentDetailModal({
  open,
  agent,
  snapshot,
  sessionKey,
  ownerAgentId,
  onClose,
  labels,
}: {
  open: boolean;
  agent: WorkflowAgentSnapshot | null;
  snapshot: WorkflowSnapshot | null;
  sessionKey?: string | null;
  ownerAgentId?: string;
  onClose: () => void;
  labels: WorkflowAgentDetailModalLabels;
}) {
  const [sessionMessages, setSessionMessages] = useState<Message[]>([]);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AgentDetailTab>('output');

  const runId = snapshot?.runId;
  const agentId = agent?.id;
  const agentSessionKey = agent?.sessionKey;

  useEffect(() => {
    if (!open || !runId || agentId == null || !agentSessionKey) {
      setSessionMessages([]);
      setSessionLoadError(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const data = await getWorkflowAgentSession(runId, agentId, { ownerAgentId });
        if (cancelled) return;
        setSessionMessages(data.messages);
        setSessionLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setSessionLoadError(err instanceof Error ? err.message : String(err));
      }
    };

    const onTranscriptUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; sessionKey?: string }>).detail;
      const updatedKey = detail?.key ?? detail?.sessionKey;
      if (updatedKey === agentSessionKey) {
        void load();
      }
    };

    void load();
    window.addEventListener('session-transcript-updated', onTranscriptUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('session-transcript-updated', onTranscriptUpdated);
    };
  }, [open, runId, agentId, agentSessionKey, ownerAgentId]);

  useEffect(() => {
    if (open) setActiveTab('output');
  }, [open, agentId]);

  const readonlyMessages = useMemo(() => sessionMessages, [sessionMessages]);

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open || agent?.status !== 'running') return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [open, agent?.status]);

  const elapsed = agent ? formatAgentElapsed(agent) : '';
  const showTranscriptPlaceholder =
    agent != null &&
    agent.status === 'running' &&
    readonlyMessages.length === 0 &&
    !agent.currentStep;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[130] bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[131] flex h-[min(90vh,52rem)] w-[min(100%-2rem,64rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none"
          aria-describedby={undefined}
        >
          {agent ? (
            <>
              <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-edge px-5 py-4">
                <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
                  {agent.label}
                </Dialog.Title>
                <Dialog.Close
                  type="button"
                  className={cn(
                    'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted',
                    'hover:bg-surface-hover hover:text-fg',
                    interaction.transition,
                    interaction.focusRingPanel,
                  )}
                  aria-label={labels.close}
                >
                  <X className="size-4" />
                </Dialog.Close>
              </div>

              <div className="shrink-0 space-y-3 border-b border-edge bg-surface-subtle/30 px-5 py-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <MetricBlock label={labels.statusHeading}>
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', agentStatusTone(agent.status))}>
                      {statusLabel(agent, labels)}
                    </span>
                  </MetricBlock>
                  <MetricBlock label={labels.phaseHeading}>
                    <span className="truncate text-xs font-medium text-fg-muted">{agent.phase || '-'}</span>
                  </MetricBlock>
                  <MetricBlock label={labels.elapsedHeading}>
                    <span className="truncate text-xs font-medium tabular-nums text-fg-muted">
                      {elapsed ? labels.workedFor(elapsed) : '-'}
                    </span>
                  </MetricBlock>
                </div>

                <section className="rounded-lg border border-edge-subtle bg-surface-panel p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                    {labels.currentStepHeading}
                  </div>
                  <div className="mt-1 wrap-break-word text-sm font-medium text-fg">
                    {agent.currentStep || (agent.status === 'running' ? labels.runningPlaceholder : '-')}
                  </div>
                </section>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <AgentDetailTabs activeTab={activeTab} onChange={setActiveTab} labels={labels} />
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {activeTab === 'output' ? (
                    <section className="space-y-4">
                      <section className="rounded-lg border border-edge-subtle bg-surface-panel p-3">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                          {labels.outputHeading}
                        </div>
                        <div className={cn(
                          'mt-2 whitespace-pre-wrap wrap-break-word text-sm leading-6',
                          agent.error ? 'font-mono text-rose-600 dark:text-rose-400' : 'text-fg-muted',
                        )}>
                          {agent.error || agent.resultPreview || agent.currentStep || labels.runningPlaceholder}
                        </div>
                      </section>
                    </section>
                  ) : null}

                  {activeTab === 'steps' ? (
                    <section className="space-y-2">
                      {(agent.steps ?? []).map((step) => (
                        <div key={step.id} className="rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0 text-sm font-medium text-fg">{step.label}</div>
                            <span className="text-xs text-fg-subtle">{step.status}</span>
                          </div>
                          {step.detail ? <div className="mt-1 break-words text-xs text-fg-muted">{step.detail}</div> : null}
                          {step.resultPreview || step.error ? (
                            <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg-subtle">
                              {step.error || step.resultPreview}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </section>
                  ) : null}

                  {activeTab === 'transcript' ? (
                    <section className="min-w-0">
                      {showTranscriptPlaceholder ? (
                        <div className="text-xs text-fg-subtle">{labels.runningPlaceholder}</div>
                      ) : null}
                      {sessionLoadError ? (
                        <div className="mb-2 rounded-md border border-edge-subtle bg-surface-hover/30 px-2 py-1 text-xs text-fg-subtle">
                          {sessionLoadError}
                        </div>
                      ) : null}
                      {readonlyMessages.length > 0 ? (
                        <ReadonlyMessageThread
                          messages={readonlyMessages}
                          sessionKey={agentSessionKey ?? sessionKey}
                          reasoningLevel="stream"
                          compact
                        />
                      ) : null}
                    </section>
                  ) : null}

                  {activeTab === 'prompt' ? (
                    <pre className="min-w-0 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-md border border-edge-subtle bg-surface-hover/30 p-3 font-mono text-xs leading-5 text-fg-muted">
                      {agent.prompt}
                    </pre>
                  ) : null}

                  {activeTab === 'logs' && snapshot ? (
                    <div className="space-y-0.5 font-mono text-xs text-fg-subtle">
                      {snapshot.logs.map((line) => (
                        <div key={line} className="wrap-break-word">
                          {line}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});

function MetricBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="mt-1 min-w-0">{children}</div>
    </div>
  );
}

function AgentDetailTabs({
  activeTab,
  onChange,
  labels,
}: {
  activeTab: AgentDetailTab;
  onChange: (tab: AgentDetailTab) => void;
  labels: WorkflowAgentDetailModalLabels;
}) {
  const tabs: Array<{ id: AgentDetailTab; label: string }> = [
    { id: 'output', label: labels.outputHeading },
    { id: 'steps', label: labels.stepsHeading },
    { id: 'transcript', label: labels.transcriptHeading },
    { id: 'prompt', label: labels.promptHeading },
    { id: 'logs', label: labels.logsHeading },
  ];

  return (
    <div className="flex shrink-0 overflow-x-auto border-b border-edge px-5 py-2">
      <PageTabs items={tabs} activeTab={activeTab} onChange={onChange} ariaLabel={labels.executionHeading} />
    </div>
  );
}
