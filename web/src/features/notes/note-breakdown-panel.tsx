import { ArrowLeft, MessageCircle, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { getNoteAgentContextStatus, rebuildNoteAgentContext, recordNoteCatalysisFeedback, type Note, type NoteChatSessionSummary } from './notes-api';

type NoteBreakdownPanelProps = {
  noteId: string;
  note: Note | null;
  catalyzing: boolean;
  onCatalyze: () => void;
  onClose: () => void;
  noteThreads: NoteChatSessionSummary[];
  openingChat: boolean;
  onOpenChat: () => void;
  onOpenNewChat: () => void;
};

export function NoteBreakdownPanel({
  noteId,
  note,
  catalyzing,
  onCatalyze,
  onClose,
  noteThreads,
  openingChat,
  onOpenChat,
  onOpenNewChat,
}: NoteBreakdownPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const n = messages(language).notes;
  const navigate = useNavigate();
  const catalysis = note?.aiDeep?.catalysis;
  const catalysisReport = catalysis?.report ?? null;
  const { data: contextStatus, mutate: mutateContextStatus, isLoading: contextStatusLoading } = useSWR(
    noteId ? ['note-agent-context-status', noteId] : null,
    () => getNoteAgentContextStatus(noteId),
    { revalidateOnFocus: false },
  );

  const handleCatalysisFeedback = useCallback(
    async (feedback: 'helpful' | 'not_helpful') => {
      try {
        await recordNoteCatalysisFeedback(noteId, feedback);
      } catch {
        // feedback save failed silently
      }
    },
    [noteId],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-edge-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          <span className="text-sm font-semibold text-fg">{n.catalysisSectionTitle}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={n.lightboxClose}
          className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4 rotate-180" aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <p className="mb-4 text-xs leading-relaxed text-fg-muted">
          {n.catalysisSectionDescription}
        </p>

        {contextStatus ? (
          <section className="mb-4 rounded-xl bg-surface-base p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-fg-muted">{n.contextStatusTitle}</div>
              <button
                type="button"
                onClick={() => void mutateContextStatus(() => rebuildNoteAgentContext(noteId), { revalidate: false })}
                disabled={contextStatusLoading}
                className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {n.contextRebuild}
              </button>
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                contextStatus.status === 'ready' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' :
                  contextStatus.status === 'partial' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300' :
                    'bg-red-500/10 text-red-600 dark:text-red-300',
              )}>
                {contextStatus.status}
              </span>
            </div>
            <div className="mt-2 text-xs leading-relaxed text-fg-muted">
              {n.contextStatusDetail
                .replace('{{attachments}}', String(contextStatus.attachments.length))
                .replace('{{tokens}}', String(contextStatus.tokenEstimate ?? 0))}
            </div>
            {contextStatus.attachments.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                {contextStatus.attachments.slice(0, 5).map((att) => (
                  <div key={att.attachmentId} className="flex items-center justify-between gap-2 rounded-lg bg-surface-hover px-2 py-1.5 text-xs">
                    <span className="min-w-0 truncate text-fg">{att.fileName}</span>
                    <span className="shrink-0 text-fg-muted">{att.status}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <button
          type="button"
          onClick={onCatalyze}
          disabled={catalyzing}
          className="w-full rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {catalyzing ? n.processing : catalysisReport ? n.recatalyze : n.catalyzeAction}
        </button>

        {catalysisReport ? (
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-xs font-medium text-fg-muted">{n.valueHypothesis}</div>
              <p className="mt-1 text-sm leading-relaxed text-fg">{catalysisReport.valueHypothesis}</p>
            </div>
            <div>
              <div className="text-xs font-medium text-fg-muted">{n.targetUsers}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {catalysisReport.targetUsers.slice(0, 5).map((user) => (
                  <span key={user} className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg">
                    {user}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-fg-muted">{n.keyQuestions}</div>
              <ul className="mt-1 space-y-1 text-sm leading-relaxed text-fg">
                {catalysisReport.keyQuestions.slice(0, 3).map((question) => (
                  <li key={question} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                    <span>{question}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-medium text-fg-muted">{n.mvpPathLabel}</div>
              <ol className="mt-1 space-y-1 text-sm leading-relaxed text-fg">
                {catalysisReport.mvpPath.slice(0, 3).map((step, index) => (
                  <li key={step} className="flex gap-2">
                    <span className="text-fg-muted">{index + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <div className="text-xs font-medium text-fg-muted">{n.risks}</div>
              <ul className="mt-1 space-y-1 text-sm leading-relaxed text-fg">
                {catalysisReport.risks.slice(0, 3).map((risk) => (
                  <li key={risk} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-muted" />
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-medium text-fg-muted">{n.nextActions}</div>
              <ul className="mt-1 space-y-1 text-sm leading-relaxed text-fg">
                {catalysisReport.nextActions.slice(0, 4).map((action) => (
                  <li key={`${action.kind}:${action.text}`} className="flex gap-2">
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                      {action.kind}
                    </span>
                    <span>{action.text}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-between border-t border-edge-subtle pt-3">
              <span className="text-xs text-fg-muted">
                {n.confidenceLabel.replace('{{percent}}', String(Math.round(catalysisReport.confidence * 100)))}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleCatalysisFeedback('helpful')}
                  className={cn(
                    'rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                    catalysis?.feedback === 'helpful' && 'bg-accent/10 text-accent',
                  )}
                  aria-label={n.feedbackHelpfulAria}
                >
                  <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => void handleCatalysisFeedback('not_helpful')}
                  className={cn(
                    'rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                    catalysis?.feedback === 'not_helpful' && 'bg-accent/10 text-accent',
                  )}
                  aria-label={n.feedbackNotHelpfulAria}
                >
                  <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-edge-subtle px-3 py-6 text-center text-sm text-fg-muted">
            {n.noCatalysisReportHint}
          </div>
        )}

        {/* Related discussions */}
        <section className="mt-6 rounded-xl bg-surface-base p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-fg">
                <MessageCircle className="h-4 w-4 text-accent" aria-hidden />
                {n.relatedThreadsTitle}
              </div>
              <p className="mt-1 text-xs text-fg-muted">{n.relatedThreadsDescription}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenChat}
                disabled={openingChat}
                className="rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {openingChat ? n.openingChat : n.openThread}
              </button>
              <button
                type="button"
                onClick={onOpenNewChat}
                disabled={openingChat}
                className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {n.newThread}
              </button>
            </div>
          </div>
          {noteThreads.length > 0 ? (
            <div className="space-y-2">
              {noteThreads.slice(0, 5).map((thread) => (
                <button
                  key={thread.key}
                  type="button"
                  onClick={() => navigate(`/chat/${encodeURIComponent(thread.key)}`)}
                  className="w-full rounded-lg border border-edge-subtle px-3 py-2 text-left transition-colors hover:bg-surface-hover"
                >
                  <div className="truncate text-sm font-medium text-fg">
                    {thread.name || n.noteDiscussionFallback}
                  </div>
                  <div className="mt-0.5 text-xs text-fg-muted">
                    {n.messageCount.replace('{{count}}', String(thread.messageCount ?? 0))}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-edge-subtle px-3 py-5 text-center text-sm text-fg-muted">
              {n.noThreads}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
