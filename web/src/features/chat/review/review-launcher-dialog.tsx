import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, GitBranch, GitCommit, ListChecks, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import {
  buildReviewCommand,
  fetchReviewContext,
  type ReviewContext,
  type ReviewContextBranch,
  type ReviewContextCommit,
  type ReviewPreset,
} from './review-launcher-api';

type ReviewStep = 'presets' | 'base' | 'commit' | 'custom';

export interface ReviewLauncherDialogProps {
  open: boolean;
  sessionKey: string | null;
  disabled?: boolean;
  chat: ChatMessages;
  onClose: () => void;
  onSendCommand: (command: string) => void;
}

function formatStatus(context: ReviewContext | null, m: ChatMessages['reviewLauncher']): string {
  const status = context?.status;
  if (!status) return '';
  if (status.isClean) return m.statusClean;
  const parts: string[] = [];
  if (status.changedFiles > 0) parts.push(m.statusChanged.replace('{{count}}', String(status.changedFiles)));
  if (status.untrackedFiles > 0) parts.push(m.statusUntracked.replace('{{count}}', String(status.untrackedFiles)));
  return parts.join(', ');
}

function branchRows(context: ReviewContext | null, query: string): ReviewContextBranch[] {
  const needle = query.trim().toLowerCase();
  const branches = (context?.branches ?? []).filter((branch) => !branch.current);
  const sorted = [...branches].sort((a, b) => {
    if (a.name === context?.defaultBaseBranch && b.name !== context.defaultBaseBranch) return -1;
    if (b.name === context?.defaultBaseBranch && a.name !== context.defaultBaseBranch) return 1;
    return a.name.localeCompare(b.name);
  });
  return needle ? sorted.filter((branch) => branch.name.toLowerCase().includes(needle)) : sorted;
}

function commitRows(context: ReviewContext | null, query: string): ReviewContextCommit[] {
  const needle = query.trim().toLowerCase();
  const commits = context?.commits ?? [];
  if (!needle) return commits;
  return commits.filter((commit) =>
    `${commit.sha} ${commit.shortSha} ${commit.subject}`.toLowerCase().includes(needle),
  );
}

function PresetButton({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex min-h-16 w-full items-center gap-3 rounded-lg border border-edge bg-surface-panel px-3 py-2.5 text-left',
        'hover:border-accent/45 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        interaction.transition,
      )}
      onClick={onClick}
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-fg-muted">{description}</span>
      </span>
    </button>
  );
}

export function ReviewLauncherDialog({
  open,
  sessionKey,
  disabled,
  chat,
  onClose,
  onSendCommand,
}: ReviewLauncherDialogProps) {
  const m = chat.reviewLauncher;
  const [context, setContext] = useState<ReviewContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<ReviewStep>('presets');
  const [query, setQuery] = useState('');
  const [instructions, setInstructions] = useState('');

  const load = () => {
    if (!sessionKey) {
      setContext(null);
      setError(m.noSession);
      return;
    }
    setLoading(true);
    setError(null);
    void fetchReviewContext(sessionKey)
      .then((next) => setContext(next))
      .catch((err: unknown) => {
        setContext(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    setStep('presets');
    setQuery('');
    setInstructions('');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionKey]);

  const branches = useMemo(() => branchRows(context, query), [context, query]);
  const commits = useMemo(() => commitRows(context, query), [context, query]);
  const status = formatStatus(context, m);

  const send = (preset: ReviewPreset, opts?: { branch?: string; commit?: string }) => {
    const command = buildReviewCommand({
      preset,
      baseBranch: opts?.branch,
      commitSha: opts?.commit,
      instructions,
    });
    onSendCommand(command);
    onClose();
  };

  const title =
    step === 'base' ? m.baseTitle :
    step === 'commit' ? m.commitTitle :
    step === 'custom' ? m.customTitle :
    m.title;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[120] bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[121] flex h-[min(86vh,34rem)] w-[min(100vw-2rem,40rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-3">
            {step !== 'presets' ? (
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={m.back}
                onClick={() => {
                  setStep('presets');
                  setQuery('');
                }}
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-sm font-semibold text-fg">{title}</Dialog.Title>
              <Dialog.Description className="truncate text-xs text-fg-muted">
                {context?.cwd ?? m.description}
              </Dialog.Description>
            </div>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={m.close}
              onClick={onClose}
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex h-full min-h-56 items-center justify-center text-sm text-fg-muted">
                <RefreshCw className="mr-2 size-4 animate-spin" />
                {m.loading}
              </div>
            ) : error ? (
              <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
                <div className="text-sm font-medium text-fg">{m.errorTitle}</div>
                <div className="mt-1 text-sm text-fg-muted">{error}</div>
                <Button type="button" className="mt-4 h-9 rounded-lg" variant="secondary" onClick={load}>
                  <RefreshCw className="size-4" />
                  {m.retry}
                </Button>
              </div>
            ) : step === 'presets' ? (
              <div className="grid gap-2">
                <PresetButton
                  icon={<GitBranch className="size-4" />}
                  title={m.presetBase}
                  description={context?.defaultBaseBranch ? m.presetBaseDescription.replace('{{branch}}', context.defaultBaseBranch) : m.presetBaseDescriptionNoDefault}
                  disabled={disabled}
                  onClick={() => setStep('base')}
                />
                <PresetButton
                  icon={<ListChecks className="size-4" />}
                  title={m.presetUncommitted}
                  description={status}
                  disabled={disabled}
                  onClick={() => send('uncommitted')}
                />
                <PresetButton
                  icon={<GitCommit className="size-4" />}
                  title={m.presetCommit}
                  description={m.presetCommitDescription.replace('{{count}}', String(context?.commits.length ?? 0))}
                  disabled={disabled}
                  onClick={() => setStep('commit')}
                />
                <PresetButton
                  icon={<ListChecks className="size-4" />}
                  title={m.presetCustom}
                  description={m.presetCustomDescription}
                  disabled={disabled}
                  onClick={() => setStep('custom')}
                />
              </div>
            ) : step === 'base' ? (
              <div className="flex flex-col gap-3">
                <SearchBox value={query} placeholder={m.searchBranches} onChange={setQuery} />
                <div className="grid gap-1">
                  {branches.length === 0 ? (
                    <div className="rounded-lg border border-edge-subtle px-3 py-6 text-center text-sm text-fg-muted">
                      {m.noBranches}
                    </div>
                  ) : branches.map((branch) => (
                    <button
                      key={branch.name}
                      type="button"
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      disabled={disabled}
                      onClick={() => send('base', { branch: branch.name })}
                    >
                      <span className="min-w-0 truncate text-sm text-fg">{branch.name}</span>
                      <span className="shrink-0 text-xs text-fg-muted">
                        {branch.name === context?.defaultBaseBranch ? m.defaultBadge : branch.remote ? m.remoteBadge : m.localBadge}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : step === 'commit' ? (
              <div className="flex flex-col gap-3">
                <SearchBox value={query} placeholder={m.searchCommits} onChange={setQuery} />
                <div className="grid gap-1">
                  {commits.length === 0 ? (
                    <div className="rounded-lg border border-edge-subtle px-3 py-6 text-center text-sm text-fg-muted">
                      {m.noCommits}
                    </div>
                  ) : commits.map((commit) => (
                    <button
                      key={commit.sha}
                      type="button"
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      disabled={disabled}
                      onClick={() => send('commit', { commit: commit.sha })}
                    >
                      <span className="font-mono text-xs text-fg-muted">{commit.shortSha}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{commit.subject}</span>
                      {commit.date ? <span className="shrink-0 text-xs text-fg-muted">{commit.date.slice(0, 10)}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <textarea
                  className="h-40 resize-none rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-disabled focus:border-accent focus:ring-2 focus:ring-accent/25"
                  value={instructions}
                  placeholder={m.customPlaceholder}
                  onChange={(event) => setInstructions(event.target.value)}
                />
                <div className="text-xs text-fg-muted">{m.customDescription}</div>
              </div>
            )}
          </div>

          {step === 'custom' ? (
            <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-4 py-3">
              <Button type="button" variant="secondary" className="h-9 rounded-lg" onClick={onClose}>
                {m.cancel}
              </Button>
              <Button type="button" variant="primary" className="h-9 rounded-lg" disabled={disabled} onClick={() => send('custom')}>
                {m.runReview}
              </Button>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SearchBox({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-edge bg-surface-base px-3 text-sm text-fg focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
      <Search className="size-4 shrink-0 text-fg-muted" />
      <input
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-disabled"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
