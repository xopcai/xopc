import { Mic, Pause, Play, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { fetchProjects } from '@/features/projects/api';
import { isElectron } from '@/lib/electron-env';
import { showToast } from '@/lib/toast';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { createDiscussion, uploadDiscussionAudio } from './discussion-api';
import type { DiscussionDraft } from './discussion-types';
import { useDiscussionRecorder } from './use-discussion-recorder';

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function DiscussionCaptureDialog({
  initialProjectId,
  onClose,
}: {
  initialProjectId?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).notes.discussionCapture;
  const token = useGatewayStore((state) => state.token);
  const recorder = useDiscussionRecorder();
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [title, setTitle] = useState('');
  const [captureMode, setCaptureMode] = useState<'solo' | 'conversation'>('conversation');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { data: projects } = useSWR(
    token ? ['discussion-capture-projects'] : null,
    () => fetchProjects({ status: 'active', limit: 100, sortBy: 'updatedAt', sortOrder: 'desc' }),
  );
  const projectOptions = useMemo(
    () => (projects?.items ?? []).map((project) => ({ value: project.id, label: project.name })),
    [projects],
  );
  const activeRecording = recorder.phase === 'requesting_permission'
    || recorder.phase === 'recording'
    || recorder.phase === 'paused'
    || recorder.phase === 'stopping';

  useEffect(() => {
    let cancelled = false;
    if (recorder.phase !== 'stopped' || !recorder.draft) {
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }
    void recorder.buildFile().then((file) => {
      if (cancelled || !file) return;
      setPreviewUrl(URL.createObjectURL(file));
    });
    return () => {
      cancelled = true;
    };
  }, [recorder.phase, recorder.draft?.id, recorder.buildFile]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const startRecording = async () => {
    setSubmitError(null);
    await recorder.start({
      ...(projectId ? { projectId } : {}),
      ...(title.trim() ? { title: title.trim() } : {}),
      language: 'auto',
      captureMode,
      consentConfirmed,
    });
  };

  const submit = async () => {
    const draft = recorder.draft;
    if (!draft || uploading) return;
    setUploading(true);
    setSubmitError(null);
    setUploadProgress(0);
    try {
      const file = await recorder.buildFile();
      if (!file || file.size === 0) throw new Error(copy.emptyRecording);
      const created = await createDiscussion({
        clientRequestId: draft.id,
        ...(draft.projectId ? { projectId: draft.projectId } : {}),
        ...(draft.title ? { title: draft.title } : {}),
        language: draft.language,
        captureMode: draft.captureMode,
        consentConfirmed: draft.consentConfirmed,
        source: isElectron() ? 'electron' : 'web',
      });
      const completed = await uploadDiscussionAudio(
        created.discussion.id,
        file,
        draft.durationMs,
        setUploadProgress,
      );
      await recorder.discard(draft.id);
      showToast({ type: 'success', title: copy.uploaded });
      onClose();
      navigate(`/discussions/${encodeURIComponent(completed.discussion.id)}`);
    } catch (caught) {
      await recorder.markUploadFailed();
      setSubmitError(caught instanceof Error ? caught.message : copy.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  const restore = async (draft: DiscussionDraft) => {
    setProjectId(draft.projectId ?? '');
    setTitle(draft.title ?? '');
    setCaptureMode(draft.captureMode);
    setConsentConfirmed(draft.consentConfirmed);
    await recorder.restore(draft);
  };

  return (
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !activeRecording && !uploading) onClose();
      }}
    >
      <div className="flex h-[min(42rem,calc(100vh-2rem))] w-[min(42rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-fg">
              <Mic className="size-4 text-accent" aria-hidden />
              {copy.title}
            </div>
            <p className="mt-1 text-sm text-fg-muted">{copy.description}</p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-40"
            aria-label={copy.close}
            disabled={activeRecording || uploading}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {recorder.phase === 'idle' || recorder.phase === 'error' ? (
            <div className="grid gap-4">
              {recorder.recoverableDrafts.length > 0 ? (
                <section className="rounded-lg border border-edge bg-surface-subtle p-3">
                  <h2 className="text-sm font-medium text-fg">{copy.recoveredTitle}</h2>
                  <div className="mt-2 grid gap-2">
                    {recorder.recoverableDrafts.map((candidate) => (
                      <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-md bg-surface-panel px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-fg">{candidate.title || copy.untitled}</p>
                          <p className="text-xs text-fg-muted">{formatDuration(candidate.durationMs)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button variant="ghost" className="h-8 rounded-lg px-2 py-1 text-xs" onClick={() => void restore(candidate)}>
                            <RotateCcw className="size-3.5" aria-hidden />
                            {copy.recover}
                          </Button>
                          <Button variant="ghost" className="h-8 rounded-lg px-2 py-1 text-xs text-danger" onClick={() => void recorder.discard(candidate.id)}>
                            <Trash2 className="size-3.5" aria-hidden />
                            {copy.discard}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <label className="grid gap-1.5 text-sm text-fg">
                <span>{copy.topic}</span>
                <input
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={copy.topicPlaceholder}
                  className="h-10 rounded-lg border border-edge bg-surface-subtle px-3 text-sm text-fg outline-none focus:border-accent"
                />
              </label>

              <label className="grid gap-1.5 text-sm text-fg">
                <span>{copy.project}</span>
                <PopoverSelect
                  value={projectId}
                  options={projectOptions}
                  placeholder={copy.noProject}
                  emptyLabel={copy.noProject}
                  onChange={setProjectId}
                />
              </label>

              <fieldset className="grid gap-2">
                <legend className="text-sm text-fg">{copy.mode}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['conversation', 'solo'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`rounded-lg border px-3 py-2 text-sm ${captureMode === mode ? 'border-accent bg-accent-soft text-accent-fg' : 'border-edge bg-surface-subtle text-fg-muted'}`}
                      onClick={() => setCaptureMode(mode)}
                    >
                      {mode === 'conversation' ? copy.conversation : copy.solo}
                    </button>
                  ))}
                </div>
              </fieldset>

              {captureMode === 'conversation' ? (
                <label className="flex items-start gap-2 rounded-lg border border-edge bg-surface-subtle p-3 text-sm text-fg-muted">
                  <input
                    type="checkbox"
                    checked={consentConfirmed}
                    onChange={(event) => setConsentConfirmed(event.target.checked)}
                    className="mt-0.5 size-4 accent-[var(--color-accent)]"
                  />
                  <span>{copy.consent}</span>
                </label>
              ) : null}

              {recorder.error ? <p className="text-sm text-danger">{recorder.error}</p> : null}
            </div>
          ) : (
            <div className="flex min-h-full flex-col items-center justify-center gap-5 py-8 text-center">
              <div className={`flex size-24 items-center justify-center rounded-full ${recorder.phase === 'stopped' ? 'bg-accent-soft text-accent-fg' : 'bg-danger-soft text-danger'}`}>
                {recorder.phase === 'stopped' ? <Square className="size-8" aria-hidden /> : <Mic className="size-8" aria-hidden />}
              </div>
              <div>
                <p className="font-mono text-4xl tabular-nums text-fg">{formatDuration(recorder.elapsedMs)}</p>
                <p className="mt-2 text-sm text-fg-muted">
                  {recorder.phase === 'paused' ? copy.paused : recorder.phase === 'stopped' ? copy.readyToUpload : copy.recording}
                </p>
              </div>
              {previewUrl && recorder.phase === 'stopped' ? (
                <audio className="w-full max-w-md" controls src={previewUrl} />
              ) : null}
              {submitError ? <p className="max-w-md text-sm text-danger">{submitError}</p> : null}
              {uploading ? (
                <div className="w-full max-w-md">
                  <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-fg-muted">{copy.uploading} {uploadProgress}%</p>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-edge px-5 py-3">
          <span className="text-xs text-fg-muted">{copy.maxDuration}</span>
          <div className="flex items-center gap-2">
            {recorder.phase === 'idle' || recorder.phase === 'error' ? (
              <Button
                variant="primary"
                disabled={captureMode === 'conversation' && !consentConfirmed}
                onClick={() => void startRecording()}
              >
                <Mic className="size-4" aria-hidden />
                {copy.start}
              </Button>
            ) : null}
            {recorder.phase === 'recording' ? (
              <>
                <Button onClick={recorder.pause}><Pause className="size-4" aria-hidden />{copy.pause}</Button>
                <Button variant="primary" onClick={() => void recorder.stop()}><Square className="size-4" aria-hidden />{copy.stop}</Button>
              </>
            ) : null}
            {recorder.phase === 'paused' ? (
              <>
                <Button onClick={recorder.resume}><Play className="size-4" aria-hidden />{copy.resume}</Button>
                <Button variant="primary" onClick={() => void recorder.stop()}><Square className="size-4" aria-hidden />{copy.stop}</Button>
              </>
            ) : null}
            {recorder.phase === 'stopped' ? (
              <>
                <Button disabled={uploading} onClick={() => recorder.draft && void recorder.discard(recorder.draft.id)}>
                  <Trash2 className="size-4" aria-hidden />{copy.discard}
                </Button>
                <Button variant="primary" disabled={uploading} onClick={() => void submit()}>
                  {copy.upload}
                </Button>
              </>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
