import { FileText, Mic, Pause, Play, Square, Unlink, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { isElectron } from '@/lib/electron-env';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import {
  acknowledgeDiscussionConsent,
  cancelDiscussion,
  createDiscussion,
  getDiscussion,
  getDiscussionCaptureSettings,
  getDiscussionTranscript,
  stopDiscussion,
  unlinkDiscussionProject,
  uploadDiscussionRecording,
  uploadDiscussionSegment,
} from './discussion-api';
import {
  deleteDiscussionLiveSegment,
  listDiscussionLiveSegments,
  saveDiscussionLiveSegment,
} from './discussion-draft-store';
import { OPEN_DISCUSSION_CAPTURE_EVENT } from './discussion-events';
import type { DiscussionDetail, DiscussionTranscript } from './discussion-types';
import { useDiscussionRecorder } from './use-discussion-recorder';

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function GlobalDiscussionCaptureHost() {
  const navigate = useNavigate();
  const token = useGatewayStore((state) => state.token);
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).notes.discussionCapture;
  const recorder = useDiscussionRecorder();
  const [visible, setVisible] = useState(false);
  const [consentVersion, setConsentVersion] = useState<number | null>(null);
  const [pendingProjectId, setPendingProjectId] = useState<string | undefined>();
  const [detail, setDetail] = useState<DiscussionDetail | null>(null);
  const [transcript, setTranscript] = useState<DiscussionTranscript | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [operationError, setOperationError] = useState<string | null>(null);
  const createPromiseRef = useRef<Promise<DiscussionDetail> | null>(null);
  const segmentUploadsRef = useRef(new Set<Promise<void>>());
  const activeSegmentUploadsRef = useRef(0);
  const segmentUploadWaitersRef = useRef<Array<() => void>>([]);

  const acquireSegmentUploadSlot = useCallback(async () => {
    if (activeSegmentUploadsRef.current < 2) {
      activeSegmentUploadsRef.current += 1;
      return;
    }
    await new Promise<void>((resolve) => segmentUploadWaitersRef.current.push(resolve));
  }, []);

  const releaseSegmentUploadSlot = useCallback(() => {
    const next = segmentUploadWaitersRef.current.shift();
    if (next) next();
    else activeSegmentUploadsRef.current -= 1;
  }, []);

  const uploadLiveSegment = useCallback(async (
    draftId: string,
    segment: { sequence: number; blob: Blob; startedAtMs: number; endedAtMs: number; sha256: string },
  ) => {
    await saveDiscussionLiveSegment({ draftId, ...segment, createdAt: Date.now() });
    const task = (async () => {
      await acquireSegmentUploadSlot();
      try {
        const created = await createPromiseRef.current;
        if (!created) throw new Error('Discussion session is unavailable');
        const next = await uploadDiscussionSegment(created.discussion.id, segment.sequence, segment);
        await deleteDiscussionLiveSegment(draftId, segment.sequence);
        setTranscript(next);
      } finally {
        releaseSegmentUploadSlot();
      }
    })();
    const tracked = task.catch(() => undefined).finally(() => segmentUploadsRef.current.delete(tracked));
    segmentUploadsRef.current.add(tracked);
  }, [acquireSegmentUploadSlot, releaseSegmentUploadSlot]);

  const retryPendingSegments = useCallback(async (draftId: string, discussionId: string) => {
    const segments = await listDiscussionLiveSegments(draftId);
    for (const segment of segments) {
      try {
        const next = await uploadDiscussionSegment(discussionId, segment.sequence, segment);
        await deleteDiscussionLiveSegment(draftId, segment.sequence);
        setTranscript(next);
      } catch {
        return;
      }
    }
  }, []);

  const beginRecording = useCallback(async (projectId: string | undefined, policyVersion: number) => {
    setConsentVersion(null);
    setPendingProjectId(undefined);
    setVisible(true);
    setOperationError(null);
    setTranscript(null);
    setDetail(null);
    setUploadProgress(0);
    const draft = await recorder.start({
      ...(projectId ? { projectId } : {}),
      onLiveSegment: uploadLiveSegment,
    });
    if (!draft) return;
    const creation = createDiscussion({
      clientRequestId: draft.id,
      ...(projectId ? { contextProjectId: projectId } : {}),
      consentPolicyVersion: policyVersion,
      source: isElectron() ? 'electron' : 'web',
    });
    createPromiseRef.current = creation;
    try {
      const created = await creation;
      setDetail(created);
      await recorder.setServerDiscussionId(created.discussion.id);
      await retryPendingSegments(draft.id, created.discussion.id);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : copy.saveFailed);
    }
  }, [copy.saveFailed, recorder, retryPendingSegments, uploadLiveSegment]);

  const prepareStart = useCallback(async (projectId?: string) => {
    if (!token || recorder.phase === 'recording' || recorder.phase === 'paused' || finishing) return;
    setVisible(true);
    setOperationError(null);
    try {
      const settings = await getDiscussionCaptureSettings();
      if (settings.consentAcknowledgedAt == null) {
        setPendingProjectId(projectId);
        setConsentVersion(settings.consentPolicyVersion);
        return;
      }
      await beginRecording(projectId, settings.consentPolicyVersion);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : copy.saveFailed);
    }
  }, [beginRecording, copy.saveFailed, finishing, recorder.phase, token]);

  useEffect(() => {
    const handler = (event: Event) => {
      const projectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
      void prepareStart(projectId);
    };
    window.addEventListener(OPEN_DISCUSSION_CAPTURE_EVENT, handler);
    return () => window.removeEventListener(OPEN_DISCUSSION_CAPTURE_EVENT, handler);
  }, [prepareStart]);

  const refreshServerState = useCallback(async () => {
    const id = detail?.discussion.id;
    if (!id) return;
    const [nextDetail, nextTranscript] = await Promise.all([
      getDiscussion(id),
      getDiscussionTranscript(id),
    ]);
    setDetail(nextDetail);
    setTranscript(nextTranscript);
  }, [detail?.discussion.id]);

  useEffect(() => {
    const handler = () => void refreshServerState();
    window.addEventListener('discussion-segment-updated', handler);
    window.addEventListener('discussion-updated', handler);
    return () => {
      window.removeEventListener('discussion-segment-updated', handler);
      window.removeEventListener('discussion-updated', handler);
    };
  }, [refreshServerState]);

  const confirmConsent = async () => {
    if (consentVersion == null) return;
    try {
      await acknowledgeDiscussionConsent(consentVersion);
      await beginRecording(pendingProjectId, consentVersion);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : copy.saveFailed);
    }
  };

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    setOperationError(null);
    try {
      const stopped = await recorder.stop();
      if (!stopped) throw new Error(copy.emptyRecording);
      const created = await createPromiseRef.current;
      if (!created) throw new Error(copy.saveFailed);
      const stopping = await stopDiscussion(
        created.discussion.id,
        stopped.lastSequence,
        stopped.durationMs,
      );
      setDetail(stopping);
      setBackgroundUploading(true);
      setVisible(false);
      void (async () => {
        try {
          await Promise.all(segmentUploadsRef.current);
          const file = await recorder.buildFile();
          if (!file || file.size === 0) throw new Error(copy.emptyRecording);
          await uploadDiscussionRecording(created.discussion.id, file, stopped.durationMs, setUploadProgress);
          await recorder.discard(stopped.id);
          setBackgroundUploading(false);
        } catch (error) {
          await recorder.markUploadFailed();
          setBackgroundUploading(false);
          setOperationError(error instanceof Error ? error.message : copy.saveFailed);
          setVisible(true);
        }
      })();
    } catch (error) {
      await recorder.markUploadFailed();
      setOperationError(error instanceof Error ? error.message : copy.saveFailed);
    } finally {
      setFinishing(false);
    }
  };

  const openNote = () => {
    if (!detail) return;
    navigate(`/notes/${encodeURIComponent(detail.note.id)}`);
  };

  const unlinkProject = async () => {
    if (!detail) return;
    try {
      setDetail(await unlinkDiscussionProject(detail.discussion.id));
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : copy.saveFailed);
    }
  };

  const recoverDraft = async () => {
    const candidate = recorder.recoverableDrafts[0];
    if (!candidate || recovering) return;
    setRecovering(true);
    setVisible(true);
    setOperationError(null);
    setUploadProgress(0);
    try {
      await recorder.restore(candidate);
      const settings = await getDiscussionCaptureSettings();
      if (settings.consentAcknowledgedAt == null) {
        throw new Error(copy.consent);
      }
      let created = candidate.serverDiscussionId
        ? await getDiscussion(candidate.serverDiscussionId).catch(() => null)
        : null;
      if (!created) {
        created = await createDiscussion({
          clientRequestId: candidate.id,
          ...(candidate.projectId ? { contextProjectId: candidate.projectId } : {}),
          consentPolicyVersion: settings.consentPolicyVersion,
          source: isElectron() ? 'electron' : 'web',
        });
      }
      createPromiseRef.current = Promise.resolve(created);
      setDetail(created);
      await recorder.setServerDiscussionId(created.discussion.id);
      if (['stopping', 'sealing', 'organizing', 'completed'].includes(created.discussion.status)) {
        if (created.discussion.status === 'stopping' && !created.discussion.audioAttachmentId) {
          const file = await recorder.buildFile();
          if (!file || file.size === 0) throw new Error(copy.emptyRecording);
          await retryPendingSegments(candidate.id, created.discussion.id);
          await uploadDiscussionRecording(created.discussion.id, file, candidate.durationMs, setUploadProgress);
        }
        await recorder.discard(candidate.id);
        return;
      }
      if (created.discussion.status !== 'recording') {
        throw new Error(created.discussion.failureMessage ?? copy.saveFailed);
      }
      const pendingSegments = await listDiscussionLiveSegments(candidate.id);
      const lastSequence = pendingSegments.reduce(
        (highest, segment) => Math.max(highest, segment.sequence),
        candidate.lastSequence,
      );
      const durationMs = Math.max(1_000, candidate.durationMs);
      const stopping = await stopDiscussion(created.discussion.id, lastSequence, durationMs);
      setDetail(stopping);
      await retryPendingSegments(candidate.id, created.discussion.id);
      const file = await recorder.buildFile();
      if (!file || file.size === 0) throw new Error(copy.emptyRecording);
      await uploadDiscussionRecording(created.discussion.id, file, durationMs, setUploadProgress);
      await recorder.discard(candidate.id);
    } catch (error) {
      await recorder.markUploadFailed();
      setOperationError(error instanceof Error ? error.message : copy.saveFailed);
    } finally {
      setRecovering(false);
    }
  };

  const discardRecoveredDraft = async () => {
    const candidate = recorder.recoverableDrafts[0];
    if (!candidate) return;
    if (candidate.serverDiscussionId) {
      await cancelDiscussion(candidate.serverDiscussionId).catch(() => undefined);
    }
    await recorder.discard(candidate.id);
  };

  if (!visible) {
    if (backgroundUploading) return null;
    const candidate = recorder.recoverableDrafts[0];
    if (!candidate) return null;
    return (
      <aside className="fixed bottom-5 right-5 z-[125] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-edge bg-surface-panel p-4 shadow-elevated">
        <p className="text-sm font-medium text-fg">{copy.recoveredTitle}</p>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{copy.recoveredDescription}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" disabled={recovering} onClick={() => void discardRecoveredDraft()}>
            {copy.discard}
          </Button>
          <Button variant="primary" disabled={recovering} onClick={() => void recoverDraft()}>
            {recovering ? copy.recovering : copy.recover}
          </Button>
        </div>
      </aside>
    );
  }

  if (consentVersion != null) {
    return (
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
        <div className="w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-edge bg-surface-panel p-5 shadow-elevated">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-fg">{copy.consentTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{copy.consent}</p>
            </div>
            <button type="button" className="rounded-lg p-2 text-fg-muted hover:bg-surface-hover" onClick={() => setVisible(false)}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {operationError ? <p className="mt-3 text-sm text-danger">{operationError}</p> : null}
          <Button variant="primary" className="mt-5 w-full" onClick={() => void confirmConsent()}>
            <Mic className="size-4" aria-hidden />
            {copy.consentAction}
          </Button>
        </div>
      </div>
    );
  }

  const active = recorder.phase === 'recording' || recorder.phase === 'paused' || recorder.phase === 'requesting_permission';
  const inferredProject = detail?.discussion.projectId && detail.discussion.projectInferenceSource !== 'context';

  return (
    <aside className="fixed bottom-5 right-5 z-[125] flex w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated" aria-label={copy.title}>
      <header className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${active ? 'animate-pulse bg-danger' : 'bg-accent'}`} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{detail?.note.title ?? copy.title}</p>
            <p className="text-xs text-fg-muted">
              {finishing ? copy.finalizing : recorder.phase === 'paused' ? copy.paused : recorder.phase === 'requesting_permission' ? copy.requesting : copy.recording}
            </p>
          </div>
        </div>
        {!active && !finishing ? (
          <button type="button" className="rounded-lg p-2 text-fg-muted hover:bg-surface-hover" aria-label={copy.close} onClick={() => setVisible(false)}>
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </header>

      <div className="grid gap-3 px-4 py-4">
        <p className="font-mono text-3xl tabular-nums text-fg">{formatDuration(recorder.elapsedMs)}</p>
        <section className="max-h-40 overflow-y-auto rounded-lg border border-edge bg-surface-subtle p-3">
          <p className="mb-2 text-xs font-medium text-fg-muted">{copy.liveTranscript}</p>
          <p className="whitespace-pre-wrap text-sm leading-6 text-fg">
            {transcript?.text || (recorder.liveTranscriptionAvailable ? copy.waitingTranscript : copy.liveUnavailable)}
          </p>
        </section>
        {inferredProject ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-fg">
            <span>{copy.projectLinked}</span>
            <button type="button" className="inline-flex items-center gap-1 font-medium" onClick={() => void unlinkProject()}>
              <Unlink className="size-3" aria-hidden /> {copy.undo}
            </button>
          </div>
        ) : null}
        {finishing && uploadProgress > 0 ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${uploadProgress}%` }} />
          </div>
        ) : null}
        {operationError || recorder.error ? <p className="text-sm text-danger">{operationError ?? recorder.error}</p> : null}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-edge px-4 py-3">
        <span className="text-xs text-fg-muted">{copy.maxDuration}</span>
        <div className="flex items-center gap-2">
          {detail ? (
            <Button variant="ghost" onClick={openNote}>
              <FileText className="size-4" aria-hidden />
              {copy.openNote}
            </Button>
          ) : null}
          {recorder.phase === 'recording' ? (
            <Button onClick={recorder.pause}><Pause className="size-4" aria-hidden />{copy.pause}</Button>
          ) : null}
          {recorder.phase === 'paused' ? (
            <Button onClick={recorder.resume}><Play className="size-4" aria-hidden />{copy.resume}</Button>
          ) : null}
          {(recorder.phase === 'recording' || recorder.phase === 'paused') ? (
            <Button variant="primary" disabled={finishing} onClick={() => void finish()}>
              <Square className="size-4" aria-hidden />
              {copy.stop}
            </Button>
          ) : null}
        </div>
      </footer>
    </aside>
  );
}
