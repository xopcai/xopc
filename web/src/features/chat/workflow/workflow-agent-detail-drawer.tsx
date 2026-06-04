/**
 * Right-hand drawer for a single workflow subagent.
 *
 * Layout: fixed header + fixed prompt, scrollable execution feed below reusing
 * main-chat {@link AssistantStepsTimeline} and {@link MarkdownView}.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { memo, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { AssistantStepsTimeline } from '@/features/chat/messages/assistant-steps-block';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { buildWorkflowAgentExecutionBlocks } from './workflow-agent-execution-blocks';
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from './workflow.types';
import { formatAgentElapsed } from './workflow.utils';

export type WorkflowAgentDetailDrawerLabels = {
  close: string;
  statusQueued: string;
  statusRunning: string;
  statusDone: string;
  statusError: string;
  statusSkipped: string;
  workedFor: (duration: string) => string;
  phaseHeading: string;
  promptHeading: string;
  stepsHeading: string;
  outputHeading: string;
  logsHeading: string;
  pin: string;
  pinned: string;
  runningPlaceholder: string;
  stream: { heading: string; empty: string };
};

function statusLabel(agent: WorkflowAgentSnapshot, labels: WorkflowAgentDetailDrawerLabels): string {
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

export const WorkflowAgentDetailDrawer = memo(function WorkflowAgentDetailDrawer({
  open,
  agent,
  snapshot,
  sessionKey,
  pinnedAgentId,
  onPinAgent,
  onClose,
  labels,
}: {
  open: boolean;
  agent: WorkflowAgentSnapshot | null;
  snapshot: WorkflowSnapshot | null;
  sessionKey?: string | null;
  pinnedAgentId: number | null;
  onPinAgent: (id: number | null) => void;
  onClose: () => void;
  labels: WorkflowAgentDetailDrawerLabels;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const toolLabels = useMemo(
    () => ({ input: m.chat.toolInput, output: m.chat.toolOutput, noOutput: m.chat.noOutput }),
    [m.chat.toolInput, m.chat.toolOutput, m.chat.noOutput],
  );
  const stepLabels = useMemo(
    () => ({
      thoughts: m.chat.thoughts,
      thoughtsStreaming: m.chat.thoughtsStreaming,
      searchedWeb: m.chat.stepSearchedWeb,
      readFile: m.chat.stepReadFile,
      stepDetails: m.chat.stepDetails,
      runCommand: m.chat.stepRunCommand,
      listDirectory: m.chat.stepListDirectory,
      writeFile: m.chat.stepWriteFile,
      editFile: m.chat.stepEditFile,
      openUrl: m.chat.stepOpenUrl,
      fetchUrl: m.chat.stepFetchUrl,
      unknownTool: m.chat.stepUnknownTool,
    }),
    [m],
  );
  const cardLabels = m.chat.toolCard;

  const executionBlocks = useMemo(
    () => (agent ? buildWorkflowAgentExecutionBlocks(agent) : []),
    [agent],
  );

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open || agent?.status !== 'running') return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [open, agent?.status]);

  const elapsed = agent ? formatAgentElapsed(agent) : '';
  const isPinned = agent != null && pinnedAgentId === agent.id;
  const showExecutionPlaceholder =
    agent != null &&
    agent.status === 'running' &&
    executionBlocks.length === 0 &&
    !agent.currentStep;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[70] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-drawer-right fixed right-0 top-0 z-[71] flex size-full max-w-md flex-col border-l border-edge bg-surface-panel shadow-popover outline-none',
          )}
          aria-describedby={undefined}
        >
          {agent ? (
            <>
              <div className="flex min-w-0 shrink-0 items-start justify-between gap-2 border-b border-edge px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate text-base font-medium text-fg">
                    {agent.label}
                  </Dialog.Title>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                    <span>{statusLabel(agent, labels)}</span>
                    {elapsed ? (
                      <span className="tabular-nums text-fg-subtle">{labels.workedFor(elapsed)}</span>
                    ) : null}
                    {agent.phase ? (
                      <span className="truncate text-fg-disabled">
                        {labels.phaseHeading}: {agent.phase}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {agent.status === 'running' ? (
                    <button
                      type="button"
                      onClick={() => onPinAgent(isPinned ? null : agent.id)}
                      className={cn(
                        'inline-flex h-7 items-center rounded-md px-2 text-xs',
                        isPinned
                          ? 'bg-accent/15 text-accent-fg'
                          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                        interaction.transition,
                        interaction.focusRingPanel,
                      )}
                      aria-pressed={isPinned}
                    >
                      {isPinned ? labels.pinned : labels.pin}
                    </button>
                  ) : null}
                  <Dialog.Close
                    type="button"
                    className={cn(
                      'inline-flex size-8 items-center justify-center rounded-md text-fg-muted',
                      'hover:bg-surface-hover hover:text-fg',
                      interaction.transition,
                      interaction.focusRingPanel,
                    )}
                    aria-label={labels.close}
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
              </div>

              <div className="shrink-0 border-b border-edge-subtle px-4 py-3">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                  {labels.promptHeading}
                </div>
                <pre className="max-h-[min(28vh,12rem)] min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-edge-subtle bg-surface-hover/30 p-2 font-mono text-xs text-fg-muted">
                  {agent.prompt}
                </pre>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 px-4 pb-2 pt-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                    {labels.stepsHeading}
                  </div>
                  {agent.currentStep ? (
                    <div className="mt-1 truncate text-xs text-accent-fg">{agent.currentStep}</div>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                  {showExecutionPlaceholder ? (
                    <div className="text-xs text-fg-subtle">{labels.runningPlaceholder}</div>
                  ) : null}

                  {executionBlocks.length > 0 ? (
                    <AssistantStepsTimeline
                      blocks={executionBlocks}
                      toolLabels={toolLabels}
                      stepLabels={stepLabels}
                      cardLabels={cardLabels}
                      sessionKey={sessionKey}
                      className="pb-2"
                    />
                  ) : null}

                  {agent.resultPreview || agent.error ? (
                    <section className="mt-4 min-w-0 border-t border-edge-subtle pt-3">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                        {labels.outputHeading}
                      </div>
                      {agent.error ? (
                        <div className="font-mono text-xs text-rose-600 dark:text-rose-400">
                          {agent.error}
                        </div>
                      ) : (
                        <div className="markdown-content min-w-0 text-sm text-fg-muted">
                          <MarkdownView content={agent.resultPreview ?? ''} compact />
                        </div>
                      )}
                    </section>
                  ) : null}

                  {snapshot && snapshot.logs.length > 0 ? (
                    <section className="mt-4 min-w-0 border-t border-edge-subtle pt-3">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                        {labels.logsHeading}
                      </div>
                      <div className="space-y-0.5 font-mono text-xs text-fg-subtle">
                        {snapshot.logs.map((line, i) => (
                          <div key={i} className="break-words">
                            {line}
                          </div>
                        ))}
                      </div>
                    </section>
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
