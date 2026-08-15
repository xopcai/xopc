import { ArrowLeft, CheckCircle2, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  completeDiscussion,
  deleteDiscussionAudio,
  getDiscussion,
  retryDiscussion,
  saveDiscussionReview,
} from '@/features/discussions/discussion-api';
import type { DiscussionAnalysis } from '@/features/discussions/discussion-types';
import { messages } from '@/i18n/messages';
import { showToast } from '@/lib/toast';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const PROCESSING = new Set(['queued', 'transcribing', 'analyzing']);

function lines(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean);
}

function ListEditor({
  label,
  values,
  onChange,
  disabled = false,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-sm text-fg">
      <span className="font-medium">{label}</span>
      <textarea
        rows={3}
        value={values.join('\n')}
        disabled={disabled}
        onChange={(event) => onChange(lines(event.target.value))}
        className="resize-y rounded-lg border border-edge bg-surface-panel px-3 py-2 outline-none focus:border-accent"
      />
    </label>
  );
}

export function DiscussionReviewPage() {
  const { discussionId = '' } = useParams();
  const token = useGatewayStore((state) => state.token);
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).notes.discussionReview;
  const { data, error, mutate, isLoading } = useSWR(
    token && discussionId ? ['discussion', discussionId] : null,
    () => getDiscussion(discussionId),
    { refreshInterval: (current) => current && PROCESSING.has(current.discussion.status) ? 1_500 : 0 },
  );
  const [draft, setDraft] = useState<DiscussionAnalysis | null>(null);
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deletingAudio, setDeletingAudio] = useState(false);

  const effectiveAnalysis = useMemo(
    () => data?.discussion.review ?? data?.discussion.analysis ?? null,
    [data?.discussion.analysis, data?.discussion.review],
  );

  useEffect(() => {
    if (!effectiveAnalysis) return;
    setDraft(effectiveAnalysis);
    setSelectedActions(new Set(
      data?.discussion.projectId ? effectiveAnalysis.actionItems.map((item) => item.id) : [],
    ));
  }, [effectiveAnalysis, data?.discussion.projectId, data?.discussion.reviewRevision]);

  if (isLoading || !data && !error) {
    return <div className="grid gap-4 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>;
  }
  if (error || !data) {
    return <div className="p-6 text-sm text-danger">{error instanceof Error ? error.message : copy.loadFailed}</div>;
  }

  const { discussion, note } = data;
  const processing = PROCESSING.has(discussion.status);

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await mutate(await saveDiscussionReview(discussion.id, draft, discussion.reviewRevision), { revalidate: false });
      showToast({ type: 'success', title: copy.saved });
    } catch (caught) {
      showToast({ type: 'error', title: copy.saveFailed, message: caught instanceof Error ? caught.message : copy.saveFailed });
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      let current = data;
      if (JSON.stringify(draft) !== JSON.stringify(effectiveAnalysis)) {
        current = await saveDiscussionReview(discussion.id, draft, discussion.reviewRevision);
      }
      const completed = await completeDiscussion(
        discussion.id,
        current.discussion.reviewRevision,
        [...selectedActions],
      );
      await mutate(completed, { revalidate: false });
      showToast({ type: 'success', title: copy.completed });
    } catch (caught) {
      showToast({ type: 'error', title: copy.completeFailed, message: caught instanceof Error ? caught.message : copy.completeFailed });
    } finally {
      setSaving(false);
    }
  };

  const deleteAudio = async () => {
    if (deletingAudio || !window.confirm(copy.deleteAudioConfirm)) return;
    setDeletingAudio(true);
    try {
      await mutate(await deleteDiscussionAudio(discussion.id), { revalidate: false });
      showToast({ type: 'success', title: copy.audioDeleted });
    } catch (caught) {
      showToast({ type: 'error', title: copy.deleteAudioFailed, message: caught instanceof Error ? caught.message : copy.deleteAudioFailed });
    } finally {
      setDeletingAudio(false);
    }
  };

  return (
    <div className="min-h-full bg-surface-base px-4 py-6 sm:px-6">
      <div className="mx-auto grid max-w-4xl gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link to={`/notes/${encodeURIComponent(note.id)}`} className="mb-2 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
              <ArrowLeft className="size-4" aria-hidden />{copy.backToNote}
            </Link>
            <h1 className="text-xl font-semibold text-fg">{note.title || copy.untitled}</h1>
            <p className="mt-1 text-sm text-fg-muted">{copy.status}: {copy.statuses[discussion.status]}</p>
          </div>
          <div className="flex items-center gap-2">
            {discussion.audioAttachmentId && !processing ? (
              <Button variant="ghost" className="text-danger hover:text-danger" disabled={deletingAudio} onClick={() => void deleteAudio()}>
                <Trash2 className="size-4" aria-hidden />{copy.deleteAudio}
              </Button>
            ) : null}
            {discussion.audioDeletedAt ? <span className="text-xs text-fg-muted">{copy.audioRemoved}</span> : null}
            <Link to={`/notes/${encodeURIComponent(note.id)}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-edge px-3 text-sm text-fg hover:bg-surface-hover">
              <FileText className="size-4" aria-hidden />{copy.openNote}
            </Link>
          </div>
        </header>

        {processing ? (
          <section className="rounded-xl border border-edge bg-surface-panel p-6">
            <div className="flex items-center gap-3">
              <RefreshCw className="size-5 animate-spin text-accent" aria-hidden />
              <div><h2 className="font-medium text-fg">{copy.processing}</h2><p className="text-sm text-fg-muted">{copy.processingHint}</p></div>
            </div>
          </section>
        ) : null}

        {discussion.status === 'failed' ? (
          <section className="rounded-xl border border-danger/30 bg-danger-soft p-5">
            <h2 className="font-medium text-danger">{copy.failed}</h2>
            <p className="mt-1 text-sm text-fg-muted">{discussion.lastErrorMessage}</p>
            <Button className="mt-4" onClick={() => void retryDiscussion(discussion.id).then(() => mutate())}>{copy.retry}</Button>
          </section>
        ) : null}

        {draft && (discussion.status === 'review_required' || discussion.status === 'completed') ? (
          <section className="grid gap-5 rounded-xl border border-edge bg-surface-panel p-5">
            <label className="grid gap-1.5 text-sm text-fg">
              <span className="font-medium">{copy.summary}</span>
              <textarea rows={4} value={draft.summary} disabled={discussion.status === 'completed'} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} className="resize-y rounded-lg border border-edge bg-surface-panel px-3 py-2 outline-none focus:border-accent disabled:bg-surface-subtle" />
            </label>
            <ListEditor label={copy.keyPoints} values={draft.keyPoints} disabled={discussion.status === 'completed'} onChange={(keyPoints) => setDraft({ ...draft, keyPoints })} />
            <ListEditor label={copy.decisions} values={draft.decisions} disabled={discussion.status === 'completed'} onChange={(decisions) => setDraft({ ...draft, decisions })} />
            <div className="grid gap-2">
              <h2 className="text-sm font-medium text-fg">{copy.actions}</h2>
              {draft.actionItems.map((action, index) => (
                <div key={action.id} className="grid gap-2 rounded-lg border border-edge bg-surface-subtle p-3 sm:grid-cols-[auto_1fr_10rem_9rem]">
                  <input type="checkbox" aria-label={copy.createTask} checked={selectedActions.has(action.id)} disabled={discussion.status === 'completed' || !discussion.projectId} onChange={(event) => setSelectedActions((current) => { const next = new Set(current); if (event.target.checked) next.add(action.id); else next.delete(action.id); return next; })} className="mt-2 size-4 accent-[var(--color-accent)]" />
                  <input value={action.title} disabled={discussion.status === 'completed'} onChange={(event) => setDraft({ ...draft, actionItems: draft.actionItems.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) })} className="h-9 rounded-lg border border-edge bg-surface-panel px-2 text-sm" />
                  <input value={action.owner ?? ''} disabled={discussion.status === 'completed'} placeholder={copy.owner} onChange={(event) => setDraft({ ...draft, actionItems: draft.actionItems.map((item, itemIndex) => itemIndex === index ? { ...item, owner: event.target.value || undefined } : item) })} className="h-9 rounded-lg border border-edge bg-surface-panel px-2 text-sm" />
                  <input value={action.dueDate ?? ''} disabled={discussion.status === 'completed'} placeholder={copy.dueDate} onChange={(event) => setDraft({ ...draft, actionItems: draft.actionItems.map((item, itemIndex) => itemIndex === index ? { ...item, dueDate: event.target.value || undefined } : item) })} className="h-9 rounded-lg border border-edge bg-surface-panel px-2 text-sm" />
                </div>
              ))}
            </div>
            <ListEditor label={copy.risks} values={draft.risks} disabled={discussion.status === 'completed'} onChange={(risks) => setDraft({ ...draft, risks })} />
            <ListEditor label={copy.openQuestions} values={draft.openQuestions} disabled={discussion.status === 'completed'} onChange={(openQuestions) => setDraft({ ...draft, openQuestions })} />
            {discussion.status === 'review_required' ? (
              <footer className="flex justify-end gap-2 border-t border-edge pt-4">
                <Button disabled={saving} onClick={() => void save()}>{copy.save}</Button>
                <Button variant="primary" disabled={saving || !draft.summary.trim()} onClick={() => void approve()}><CheckCircle2 className="size-4" aria-hidden />{copy.approve}</Button>
              </footer>
            ) : <p className="text-sm text-positive">{copy.completed}</p>}
          </section>
        ) : null}
      </div>
    </div>
  );
}
