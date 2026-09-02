import * as Dialog from '@radix-ui/react-dialog';
import { Check, Clipboard, Download, ExternalLink, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import {
  downloadSupportReport,
  githubIssueUrl,
  openSupportIssue,
  prepareSupportInvestigation,
  type SupportReport,
  type SupportReportInput,
} from './support-report-api';
import { startSupportInvestigationSession } from './support-investigation-session';

export type SupportReportSeed = Partial<SupportReportInput>;

export function SupportReportDialog({
  open,
  onOpenChange,
  seed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seed?: SupportReportSeed;
}) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).supportReport;
  const reportRef = useRef<HTMLTextAreaElement>(null);
  const [problem, setProblem] = useState('');
  const [reproduction, setReproduction] = useState('');
  const [expected, setExpected] = useState('');
  const [report, setReport] = useState<SupportReport | null>(null);
  const [investigationPrompt, setInvestigationPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProblem(seed?.problem ?? '');
    setReproduction(seed?.reproduction ?? '');
    setExpected(seed?.expected ?? '');
    setReport(null);
    setInvestigationPrompt('');
    setBusy(false);
    setStarting(false);
    setError(null);
    setNotice(null);
  }, [open, seed]);

  async function collect() {
    const trimmedProblem = problem.trim();
    if (!trimmedProblem) {
      setError(copy.problemRequired);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await prepareSupportInvestigation({
        ...seed,
        problem: trimmedProblem,
        reproduction: reproduction.trim() || undefined,
        expected: expected.trim() || undefined,
        occurredAt: seed?.occurredAt ?? new Date().toISOString(),
        clientContext: {
          currentPage: window.location.href,
          surface: window.electronAPI ? 'electron' : 'web',
          userAgent: navigator.userAgent,
          ...seed?.clientContext,
        },
      });
      setReport(next.report);
      setInvestigationPrompt(next.investigationPrompt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.collectFailed);
    } finally {
      setBusy(false);
    }
  }

  async function copyReport(): Promise<boolean> {
    if (!report) return false;
    const copied = await copyTextToClipboard(report.markdown);
    setNotice(copied ? copy.copied : copy.copyFailed);
    if (!copied) {
      reportRef.current?.focus();
      reportRef.current?.select();
    }
    return copied;
  }

  async function submitToGithub() {
    if (!report) return;
    if (report.markdown.length > 6_000) await copyReport();
    const opened = await openSupportIssue(githubIssueUrl(report, copy.githubTruncated));
    if (!opened) setError(copy.openFailed);
  }

  async function startInvestigation() {
    if (!report || !investigationPrompt) return;
    setStarting(true);
    setError(null);
    try {
      const sessionKey = await startSupportInvestigationSession(report, investigationPrompt);
      onOpenChange(false);
      window.dispatchEvent(new CustomEvent('navigate-to-chat', { detail: { sessionKey } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.sessionFailed);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[220] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[221] flex h-[min(42rem,calc(100vh-2rem))] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
            'rounded-2xl border border-edge bg-surface-panel shadow-popover dark:border-edge',
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-fg">{copy.title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">{copy.subtitle}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="shrink-0 rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={copy.close}
              >
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {busy ? (
              <div className="space-y-4" aria-label={copy.collecting}>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : report ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-xl bg-accent-soft px-3 py-2.5 text-sm text-accent-fg">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <div>
                    <p className="font-medium">{copy.ready}</p>
                    <p className="mt-0.5 text-xs leading-5">
                      {copy.readyDetail
                        .replace('{{checks}}', String(report.doctor.length))
                        .replace('{{logs}}', String(report.logs.length))
                        .replace('{{redactions}}', String(report.redaction.replacements))}
                    </p>
                  </div>
                </div>
                <label className="block" htmlFor="support-report-preview">
                  <span className="mb-1.5 block text-xs font-medium text-fg-muted">{copy.preview}</span>
                  <textarea
                    ref={reportRef}
                    id="support-report-preview"
                    value={report.markdown}
                    readOnly
                    className="h-96 w-full resize-none rounded-xl border border-edge bg-surface-base p-3 font-mono text-xs leading-5 text-fg outline-none focus:border-accent"
                  />
                </label>
                <p className="flex items-start gap-2 text-xs leading-5 text-fg-muted">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-fg" aria-hidden />
                  {copy.investigationHint}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block" htmlFor="support-problem">
                  <span className="mb-1.5 block text-xs font-medium text-fg-muted">{copy.problem}</span>
                  <textarea
                    id="support-problem"
                    value={problem}
                    onChange={(event) => setProblem(event.target.value)}
                    placeholder={copy.problemPlaceholder}
                    className="min-h-28 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
                    autoFocus
                  />
                </label>
                <label className="block" htmlFor="support-reproduction">
                  <span className="mb-1.5 block text-xs font-medium text-fg-muted">{copy.reproduction}</span>
                  <textarea
                    id="support-reproduction"
                    value={reproduction}
                    onChange={(event) => setReproduction(event.target.value)}
                    placeholder={copy.reproductionPlaceholder}
                    className="min-h-20 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
                  />
                </label>
                <label className="block" htmlFor="support-expected">
                  <span className="mb-1.5 block text-xs font-medium text-fg-muted">{copy.expected}</span>
                  <textarea
                    id="support-expected"
                    value={expected}
                    onChange={(event) => setExpected(event.target.value)}
                    placeholder={copy.expectedPlaceholder}
                    className="min-h-20 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
                  />
                </label>
                <p className="flex items-start gap-2 text-xs leading-5 text-fg-muted">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-fg" aria-hidden />
                  {copy.privacy}
                </p>
              </div>
            )}

            {error ? <p className="mt-4 text-sm text-warning" role="alert">{error}</p> : null}
            {notice ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-accent-fg" role="status">
                <Check className="size-4" aria-hidden />{notice}
              </p>
            ) : null}
          </div>

          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge px-5 py-3">
            {report ? (
              <>
                <Button variant="ghost" disabled={starting} onClick={() => {
                  setReport(null);
                  setInvestigationPrompt('');
                }}>{copy.back}</Button>
                <Button onClick={() => void copyReport()}><Clipboard className="size-4" aria-hidden />{copy.copy}</Button>
                <Button onClick={() => downloadSupportReport(report)}><Download className="size-4" aria-hidden />{copy.download}</Button>
                <Button onClick={() => void submitToGithub()}>
                  <ExternalLink className="size-4" aria-hidden />{copy.submit}
                </Button>
                <Button variant="primary" disabled={starting} onClick={() => void startInvestigation()}>
                  {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                  {starting ? copy.startingInvestigation : copy.startInvestigation}
                </Button>
              </>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void collect()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy ? copy.collecting : copy.collect}
              </Button>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
