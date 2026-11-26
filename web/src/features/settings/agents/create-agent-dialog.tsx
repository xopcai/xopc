import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { ExternalRuntimeAvatar } from '@/components/brand/external-runtime-avatar';
import { Button } from '@/components/ui/button';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import {
  ExternalRuntimeConfigForm,
  ExternalRuntimeStatusDot,
  externalRuntimeStatusLabel,
} from '@/features/settings/agents/external-runtime-config';
import type {
  ExternalAgentExecution,
  ExternalAgentKind,
  ExternalRuntimeProbeResult,
} from '@/features/settings/types/agent-gateway';
import type { AgentsSettingsMessages, MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

const inputClass = 'w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

const DEFAULT_RUNTIME_NAMES = new Set(['', 'Codex', 'Antigravity', 'Claude Code']);

export type ManualAgentDraft = {
  open: boolean;
  name: string;
  instructions: string;
  workspace: string;
  execution: 'embedded' | ExternalAgentKind;
  executionConfig?: ExternalAgentExecution;
};

export function CreateAgentDialog({
  draft,
  busy,
  error,
  zh,
  externalRuntimes,
  messages,
  workingDirectoryMessages,
  onChange,
  onCreate,
  onOpenChange,
}: {
  draft: ManualAgentDraft;
  busy: boolean;
  error: string | null;
  zh: boolean;
  externalRuntimes?: ExternalRuntimeProbeResult[];
  messages: AgentsSettingsMessages;
  workingDirectoryMessages: MessageBundle['chat']['workingDirectory'];
  onChange: (patch: Partial<Omit<ManualAgentDraft, 'open'>>) => void;
  onCreate: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const selectExecution = (next: 'embedded' | ExternalAgentKind) => {
    if (next === draft.execution) return;
    const trimmedName = draft.name.trim();
    const shouldAutoName = DEFAULT_RUNTIME_NAMES.has(trimmedName);
    if (next === 'embedded') {
      onChange({
        execution: 'embedded',
        executionConfig: undefined,
        ...(shouldAutoName ? { name: '' } : {}),
      });
      return;
    }
    const defaultName = next === 'codex' ? 'Codex' : next === 'claude' ? 'Claude Code' : 'Antigravity';
    onChange({
      execution: next,
      executionConfig: { kind: next },
      ...(shouldAutoName ? { name: defaultName } : {}),
    });
  };

  const activeExternalConfig: ExternalAgentExecution | null =
    draft.execution === 'embedded'
      ? null
      : (draft.executionConfig?.kind === draft.execution ? draft.executionConfig : { kind: draft.execution });

  const runtimeOptions: Array<{
    id: 'embedded' | ExternalAgentKind;
    label: string;
    subtitle: string;
    probe?: ExternalRuntimeProbeResult;
  }> = [
    {
      id: 'embedded',
      label: 'xopc',
      subtitle: zh ? '内置智能体运行时' : 'Built-in runtime',
    },
    {
      id: 'codex',
      label: 'Codex',
      subtitle: 'codex app-server',
      probe: externalRuntimes?.find((entry) => entry.kind === 'codex'),
    },
    {
      id: 'agy',
      label: 'Antigravity',
      subtitle: 'agy acp',
      probe: externalRuntimes?.find((entry) => entry.kind === 'agy'),
    },
    {
      id: 'claude',
      label: 'Claude Code',
      subtitle: 'claude stream-json',
      probe: externalRuntimes?.find((entry) => entry.kind === 'claude'),
    },
  ];

  return (
    <Dialog.Root open={draft.open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
        <Dialog.Content className={cn(
          'xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(44rem,calc(100dvh-2rem))] w-[min(94vw,40rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover',
          SETTINGS_SHELL_CONTENT_Z,
        )}>
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">{messages.manualCreateTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                {messages.manualCreateDescription}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="touch-target shrink-0 rounded-lg p-2 text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={messages.manualCreateClose}>
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {error ? <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}

            <div className="space-y-2">
              <span className="block text-xs font-medium text-fg-muted">{messages.manualCreateExecution}</span>
              <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label={messages.manualCreateExecution}>
                {runtimeOptions.map((option) => {
                  const selected = draft.execution === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy}
                      onClick={() => selectExecution(option.id)}
                      className={cn(
                        'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        selected
                          ? 'border-accent bg-accent-soft/40 text-fg'
                          : 'border-edge bg-surface-base text-fg hover:bg-surface-hover',
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-1.5">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          {option.id !== 'embedded' ? <ExternalRuntimeAvatar kind={option.id} size={20} /> : null}
                          <span className="truncate text-sm font-semibold">{option.label}</span>
                        </span>
                        {option.id !== 'embedded' ? (
                          <ExternalRuntimeStatusDot status={option.probe?.status} />
                        ) : null}
                      </div>
                      <span className="truncate font-mono text-[11px] text-fg-muted">{option.subtitle}</span>
                      {option.id !== 'embedded' && option.probe ? (
                        <span className="text-[11px] text-fg-subtle">
                          {externalRuntimeStatusLabel(option.probe.status, zh)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {draft.execution === 'codex' ? <p className="text-xs leading-5 text-fg-subtle">{messages.manualCreateCodexHint}</p> : null}
              {draft.execution === 'agy' ? <p className="text-xs leading-5 text-fg-subtle">{messages.manualCreateAgyHint}</p> : null}
              {draft.execution === 'claude' ? (
                <p className="text-xs leading-5 text-fg-subtle">
                  {zh
                    ? '通过本机 Claude Code CLI 执行项目任务，支持思考级别、计划模式、工具审批与长连接会话复用。'
                    : 'Runs Project tasks through your local Claude Code CLI with effort levels, Plan mode, approvals, and warm session reuse.'}
                </p>
              ) : null}
            </div>

            <label htmlFor="manual-agent-name" className="block text-xs font-medium text-fg-muted">
              {messages.manualCreateName}
              <input
                id="manual-agent-name"
                autoFocus
                className={`${inputClass} mt-1.5`}
                value={draft.name}
                onChange={(event) => onChange({ name: event.target.value })}
                placeholder={messages.manualCreateNamePlaceholder}
              />
            </label>

            {activeExternalConfig ? (
              <ExternalRuntimeConfigForm
                value={activeExternalConfig}
                initialProbe={externalRuntimes?.find((entry) => entry.kind === activeExternalConfig.kind)}
                disabled={busy}
                zh={zh}
                workingDirectoryMessages={workingDirectoryMessages}
                onChange={(executionConfig) => onChange({ executionConfig })}
              />
            ) : null}

            <label htmlFor="manual-agent-instructions" className="block text-xs font-medium text-fg-muted">
              {messages.manualCreateInstructions}
              <textarea
                id="manual-agent-instructions"
                rows={3}
                className={`${inputClass} mt-1.5 resize-y leading-6`}
                value={draft.instructions}
                onChange={(event) => onChange({ instructions: event.target.value })}
                placeholder={messages.manualCreateInstructionsPlaceholder}
              />
            </label>

            {draft.execution === 'embedded' ? (
              <div>
                <label htmlFor="manual-agent-workspace" className="block text-xs font-medium text-fg-muted">
                  {messages.manualCreateWorkspace}
                </label>
                <p className="mt-1 text-xs leading-5 text-fg-subtle">{messages.manualCreateWorkspaceHint}</p>
                <div className="mt-2">
                  <DirectoryPickerPathField
                    value={draft.workspace}
                    onChange={(workspace) => onChange({ workspace })}
                    disabled={busy}
                    wd={workingDirectoryMessages}
                    placeholder={messages.manualCreateWorkspacePlaceholder}
                    inputAriaLabel={messages.manualCreateWorkspace}
                    inputClassName={`${inputClass} font-mono`}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <footer className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
            <Dialog.Close asChild><Button disabled={busy}>{messages.manualCreateCancel}</Button></Dialog.Close>
            <Button variant="primary" disabled={busy || !draft.name.trim()} aria-busy={busy} onClick={onCreate}>
              {busy ? messages.manualCreating : messages.manualCreateSubmit}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
