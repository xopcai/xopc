import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { RecordingOutcomeCard, recordingOutcomeInput } from './recording-outcome-card';
import { Bookmark, FileText, Mic, Pause, Play, Square, Unlink, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { isElectron } from '@/lib/electron-env';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import {
  acknowledgeDiscussionConsent,
  createDiscussion,
  getDiscussion,
  retryDiscussion,
  getDiscussionCaptureSettings,
  getDiscussionTranscript,
  unlinkDiscussionProject,
  uploadDiscussionSegment,
} from './discussion-api';
import {
  deleteDiscussionLiveSegment,
  listDiscussionLiveSegments,
  listDiscussionDrafts,
  saveDiscussionLiveSegment,
} from './discussion-draft-store';
import { readDiscussionConsent, rememberDiscussionConsent } from './discussion-consent-cache';
import { OPEN_DISCUSSION_CAPTURE_EVENT } from './discussion-events';
import { drainDiscussionSegmentUploadQueue } from './discussion-segment-upload-queue';
import type { DiscussionDetail, DiscussionDraft, DiscussionTranscript } from './discussion-types';
import { projectRecordingStatus, verifiedSavedThrough, type RecordingSyncStage } from './recording-status';
import { RecordingFloatingPanel } from './recording-floating-panel';
import { RecordingStatusPanel } from './recording-status-panel';
import { syncDiscussionAnnotations } from './discussion-annotation-sync';
import { acquireRecordingLease } from './recording-lease';
import { exportLocalRecording } from './recording-local-export';
import { uploadDraftRecording } from './recording-upload';
import { useDiscussionRecorder } from './use-discussion-recorder';

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function GlobalDiscussionCaptureHost() {
  const navigate = useNavigate();
  const token = useGatewayStore((state) => state.conversationId);
  const gatewayUrl = useGatewayStore(state => state.baseUrl);
  const [annotationSyncFailed, setAnnotationSyncFailed] = useState(false);
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [showRecoveries, setShowRecoveries] = useState(false);
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).notes.discussionCapture;
  const recorder = useDiscussionRecorder();
  const [compact, setCompact] = useState(false);
  const [visible, setVisible] = useState(false);
  const [consentVersion, setConsentVersion] = useState<number | null>(null);
  const [pendingProjectId, setPendingProjectId] = useState<string | undefined>();
  const [detail, setDetail] = useState<DiscussionDetail | null>(null);
  const [transcript, setTranscript] = useState<DiscussionTranscript | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingSegmentCount, setPendingSegmentCount] = useState(0);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [syncStage, setSyncStage] = useState<RecordingSyncStage>('pending');
  const [localReleased, setLocalReleased] = useState(false);
  const [locallyFinalized, setLocallyFinalized] = useState<DiscussionDraft | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const status = projectRecordingStatus({ phase: recorder.phase, draft: localReleased ? null : recorder.draft, locallyFinalized: localReleased ? null : locallyFinalized, online, syncStage,
    detail, transcript, pendingText: pendingSegmentCount, liveAvailable: recorder.liveTranscriptionAvailable });
  const activeRecording = ['recording', 'waiting_for_audio', 'requesting_permission', 'paused', 'stopping'].includes(recorder.phase);
  const busyRecovery = useRef(false);
  const originalUploadRef = useRef<Promise<unknown> | null>(null);
  const finishInFlightRef = useRef(false);
  const recordingSessionRef = useRef(false);
  const createPromiseRef = useRef<Promise<DiscussionDetail> | null>(null);
  const segmentQueueTargetRef = useRef<{ draftId: string; discussionId: string } | null>(null);
  const segmentQueueAbortRef = useRef<AbortController | null>(null);
  const segmentQueuePromiseRef = useRef<Promise<void> | null>(null);
  const restartSegmentQueueRef = useRef<() => void>(() => {});

  const ensureSegmentQueueDrain = useCallback((): Promise<void> => {
    const existing = segmentQueuePromiseRef.current;
    if (existing) return existing;
    const target = segmentQueueTargetRef.current;
    if (!target) return Promise.resolve();
    const controller = new AbortController();
    segmentQueueAbortRef.current = controller;
    const running = drainDiscussionSegmentUploadQueue(target, {
      list: listDiscussionLiveSegments,
      upload: (discussionId, segment) => uploadDiscussionSegment(discussionId, segment.sequence, segment),
      remove: (draftId, segment) => deleteDiscussionLiveSegment(draftId, segment.sequence),
      onTranscript: setTranscript,
      onPendingCount: setPendingSegmentCount,
    }, controller.signal).finally(() => {
      if (segmentQueuePromiseRef.current !== running) return;
      segmentQueuePromiseRef.current = null;
      if (segmentQueueAbortRef.current === controller) segmentQueueAbortRef.current = null;
    });
    segmentQueuePromiseRef.current = running;
    void running.then(() => {
      window.setTimeout(() => restartSegmentQueueRef.current(), 0);
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setOperationError(error instanceof Error ? error.message : copy.saveFailed);
      }
    });
    return running;
  }, []);
  restartSegmentQueueRef.current = () => {
    const target = segmentQueueTargetRef.current;
    if (!target || segmentQueuePromiseRef.current) return;
    void listDiscussionLiveSegments(target.draftId).then((segments) => {
      setPendingSegmentCount(segments.length);
      if (segments.length > 0) void ensureSegmentQueueDrain();
    });
  };

  const connectSegmentQueue = useCallback((draftId: string, discussionId: string): Promise<void> => {
    const current = segmentQueueTargetRef.current;
    if (current && (current.draftId !== draftId || current.discussionId !== discussionId)) {
      segmentQueueAbortRef.current?.abort();
      segmentQueuePromiseRef.current = null;
    }
    segmentQueueTargetRef.current = { draftId, discussionId };
    return ensureSegmentQueueDrain();
  }, [ensureSegmentQueueDrain]);

  const uploadLiveSegment = useCallback(async (
    draftId: string,
    segment: { sequence: number; blob: Blob; startedAtMs: number; endedAtMs: number; sha256: string },
  ) => {
    await saveDiscussionLiveSegment({ draftId, ...segment, createdAt: Date.now() });
    setPendingSegmentCount((count) => count + 1);
    void ensureSegmentQueueDrain();
  }, [ensureSegmentQueueDrain]);

  const beginRecording = useCallback(async (projectId: string | undefined, policyVersion: number) => {
    setCompact(false);
    setConsentVersion(null);
    setPendingProjectId(undefined);
    setVisible(true);
    setOperationError(null);
    setTranscript(null);
    setDetail(null);
    setUploadProgress(0);
    setLocalReleased(false); setAnnotationSyncFailed(false); setLocallyFinalized(null); setSyncStage('pending');
    const draft = await recorder.start({
      ...(projectId ? { projectId } : {}),
      consentPolicyVersion: policyVersion,
      gatewayUrl,
      onLiveSegment: uploadLiveSegment,
    });
    if (!draft) return;
    recordingSessionRef.current = true;
    const creation = createDiscussion({
      clientRequestId: draft.id,
      ...(projectId ? { contextProjectId: projectId } : {}),
      consentPolicyVersion: policyVersion,
      source: isElectron() ? 'electron' : 'web',
      recordedAt: draft.startedAt,
    });
    createPromiseRef.current = creation;
    try {
      const created = await creation;
      setDetail(created);
      await recorder.setServerDiscussionId(created.discussion.id);
      void connectSegmentQueue(draft.id, created.discussion.id);
    } catch (error) {
      setSyncStage('failed');
      setOperationError(error instanceof Error ? error.message : copy.saveFailed);
    }
  }, [connectSegmentQueue, copy.saveFailed, recorder, uploadLiveSegment, gatewayUrl]);

  useEffect(() => () => segmentQueueAbortRef.current?.abort(), []);

  const prepareStart = useCallback(async (projectId?: string) => {
    if (!token || ['recording', 'waiting_for_audio', 'requesting_permission', 'paused', 'stopping'].includes(recorder.phase) || finishing) return;
    setVisible(true);
    setOperationError(null);
    try {
      const settings = readDiscussionConsent() ?? await getDiscussionCaptureSettings();
      rememberDiscussionConsent(settings);
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

  useEffect(() => {
    const draft = recorder.draft;
    const id = detail?.discussion.id;
    if (!draft || !id || !draft.chunkCount || finishing || originalUploadRef.current || !['recording', 'waiting_for_audio', 'paused'].includes(recorder.phase)) return;
    const upload = uploadDraftRecording(draft, id, setUploadProgress, false, setSyncStage)
      .catch((error) => { setSyncStage('failed'); setOperationError(error instanceof Error ? error.message : copy.saveFailed); })
      .finally(() => { originalUploadRef.current = null; });
    originalUploadRef.current = upload;
  }, [recorder.draft, recorder.phase, detail?.discussion.id, finishing, copy.saveFailed]);

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
    const handler = () => void refreshServerState().catch(() => undefined);
    window.addEventListener('discussion-segment-updated', handler);
    window.addEventListener('discussion-updated', handler);
    return () => {
      window.removeEventListener('discussion-segment-updated', handler);
      window.removeEventListener('discussion-updated', handler);
    };
  }, [refreshServerState]);

  useEffect(() => {
    if (!detail || (!['stopping', 'sealing', 'organizing'].includes(detail.discussion.status) && !['queued','running'].includes(detail.recordingJob?.state ?? ''))) return;
    const timer = window.setInterval(() => void refreshServerState().catch(() => undefined), 3_000);
    return () => window.clearInterval(timer);
  }, [detail, refreshServerState]);

  const confirmConsent = async () => {
    if (consentVersion == null) return;
    try {
      rememberDiscussionConsent(await acknowledgeDiscussionConsent(consentVersion));
      await beginRecording(pendingProjectId, consentVersion);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : copy.saveFailed);
    }
  };

  const finish = async () => {
    if (finishInFlightRef.current) return;
    finishInFlightRef.current = true;
    recordingSessionRef.current = false;
    setFinishing(true);
    setOperationError(null);
    let releaseLease: (() => void) | undefined;
    try {
      const stopped = await recorder.stop();
      if (!stopped) throw new Error(copy.emptyRecording);
      setLocalReleased(false); setLocallyFinalized(stopped);
      releaseLease = await acquireRecordingLease(stopped.id);
      const created = await createPromiseRef.current?.catch(() => null) ?? await createDiscussion({
        clientRequestId: stopped.id,
        ...(stopped.projectId ? { contextProjectId: stopped.projectId } : {}),
        consentPolicyVersion: stopped.consentPolicyVersion ?? (await getDiscussionCaptureSettings()).consentPolicyVersion,
        source: isElectron() ? 'electron' : 'web',
        recordedAt: stopped.startedAt,
      });
      createPromiseRef.current = Promise.resolve(created);
      setDetail(created);
      await recorder.setServerDiscussionId(created.discussion.id);
      setBackgroundUploading(true);
      await originalUploadRef.current;
      const uploaded = await uploadDraftRecording(stopped, created.discussion.id, setUploadProgress, true, setSyncStage);
      // The original recording repairs failed live text; a live outage must not block saving.
      segmentQueueAbortRef.current?.abort();
      if (!uploaded?.discussion.audioAttachmentId || uploaded.discussion.audioDeletedAt) throw new Error('Original audio attachment is not confirmed');
      setDetail(uploaded);
      try { await syncDiscussionAnnotations(stopped.id,created.discussion.id); setAnnotationSyncFailed(false); await recorder.discard(stopped.id); setLocalReleased(true); }
      catch { setAnnotationSyncFailed(true); }
      segmentQueueTargetRef.current = null;
      setPendingSegmentCount(0);

    } catch (error) {
      setSyncStage('failed');
      await recorder.markUploadFailed().catch(() => undefined);
      setOperationError(error instanceof Error ? error.message : copy.saveFailed);
      setVisible(true);
    } finally {
      releaseLease?.();
      finishInFlightRef.current = false;
      setFinishing(false);
      setBackgroundUploading(false);
    }
  };

  useEffect(() => {
    if (recorder.phase === 'stopped' && recorder.draft?.saveOutcome === 'complete' && recordingSessionRef.current) void finish();
  });

  const openNote = () => {
    if (!detail) return;
    setCompact(true);
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

  const recoverDraft = async (selected?: DiscussionDraft) => {
    let candidate = selected ?? recorder.recoverableDrafts[0];
    if (!candidate || recovering || busyRecovery.current || finishInFlightRef.current || activeRecording) return;
    busyRecovery.current = true;
    recordingSessionRef.current = false;
    setRecovering(true);
    setVisible(true);
    setOperationError(null);
    setUploadProgress(0);
    let releaseLease: (() => void) | undefined;
    try {
      releaseLease = await acquireRecordingLease(candidate.id);
      if (candidate.gatewayUrl && candidate.gatewayUrl !== gatewayUrl) throw new Error(language === 'zh' ? '请切回录制时的 Gateway 后恢复' : 'Return to the original Gateway to recover');
      candidate = await recorder.restore(candidate);
      setLocalReleased(false); setLocallyFinalized(candidate);
      const settings = readDiscussionConsent() ?? await getDiscussionCaptureSettings();
      rememberDiscussionConsent(settings);
      if (settings.consentAcknowledgedAt == null) {
        throw new Error(copy.consent);
      }
      let created = candidate.serverDiscussionId
        ? await getDiscussion(candidate.serverDiscussionId)
        : null;
      if (!created) {
        created = await createDiscussion({
          clientRequestId: candidate.id,
          ...(candidate.projectId ? { contextProjectId: candidate.projectId } : {}),
          consentPolicyVersion: settings.consentPolicyVersion,
          source: isElectron() ? 'electron' : 'web',
          recordedAt: candidate.startedAt,
        });
      }
      createPromiseRef.current = Promise.resolve(created);
      setDetail(created);
      await recorder.setServerDiscussionId(created.discussion.id);
      let annotationsSynced = false;
      try { await syncDiscussionAnnotations(candidate.id,created.discussion.id); annotationsSynced = true; setAnnotationSyncFailed(false); }
      catch { setAnnotationSyncFailed(true); }
      if (created.discussion.audioDeletedAt) throw new Error('Original recording was deleted');
      if (created.discussion.audioAttachmentId && ['sealing', 'organizing', 'completed'].includes(created.discussion.status)) {
        if (annotationsSynced) { await recorder.discard(candidate.id); setLocalReleased(true); }
        return;
      }
      if (created.discussion.status === 'cancelled') throw new Error('This recording was cancelled');
      if (!created.discussion.audioAttachmentId) await uploadDraftRecording(candidate, created.discussion.id, setUploadProgress, true, setSyncStage);
      segmentQueueAbortRef.current?.abort();
      const current = await getDiscussion(created.discussion.id);
      if (!current.discussion.audioAttachmentId || current.discussion.audioDeletedAt) throw new Error('Original audio attachment is not confirmed');
      if (current.discussion.status === 'needs_attention') {
        setDetail(await retryDiscussion(created.discussion.id));
      } else {
        setDetail(current);
      }
      if (annotationsSynced) { await recorder.discard(candidate.id); setLocalReleased(true); }
    } catch (error) {
      await recorder.markUploadFailed(candidate.id).catch(() => undefined);
      setSyncStage('failed');
      setOperationError(error instanceof Error ? error.message : copy.saveFailed);
    } finally {
      releaseLease?.();
      busyRecovery.current = false; setRecovering(false);
    }
  };

  const continueDraft = async (candidate: DiscussionDraft) => {
    if (busyRecovery.current || finishInFlightRef.current || ['recording', 'waiting_for_audio', 'paused', 'requesting_permission', 'stopping'].includes(recorder.phase)) return;
    busyRecovery.current = true; setRecovering(true); setOperationError(null);
    try {
      if (candidate.gatewayUrl && candidate.gatewayUrl !== gatewayUrl) throw new Error('Return to the original Gateway before continuing.');
      // A seal request may have committed even when its HTTP response was lost.
      if (candidate.sealRequested) throw new Error('Recover and sync this submitted recording first.');
      const existing = candidate.serverDiscussionId ? await getDiscussion(candidate.serverDiscussionId) : null;
      if (existing && (existing.discussion.audioAttachmentId || existing.recordingJob || !['recording', 'needs_attention'].includes(existing.discussion.status))) throw new Error('Recover and sync this submitted recording first.');
      const resumed = await recorder.start({ continuation: candidate, gatewayUrl, onLiveSegment: uploadLiveSegment });
      if (!resumed) return;
      createPromiseRef.current = existing ? Promise.resolve(existing) : null;
      setDetail(existing); setTranscript(null); setLocalReleased(false); setAnnotationSyncFailed(false); setLocallyFinalized(null); setSyncStage('pending');
      setShowRecoveries(false); setVisible(true); recordingSessionRef.current = true;
    } catch (error) { setOperationError(error instanceof Error ? error.message : copy.saveFailed); }
    finally { busyRecovery.current = false; setRecovering(false); }
  };
  const discardRecoveredDraft = async (selected?: DiscussionDraft) => {
    if (finishInFlightRef.current || recovering || activeRecording) return;
    const candidate = selected ?? recorder.recoverableDrafts[0];
    if (!candidate) return;
    let releaseLease: (() => void) | undefined;
    try { releaseLease = await acquireRecordingLease(candidate.id); await recorder.discard(candidate.id); } catch (error) { setOperationError(error instanceof Error ? error.message : copy.saveFailed); }
    finally { releaseLease?.(); }
  };
  const exportDraft = async (candidate: DiscussionDraft) => {
    if (busyRecovery.current || finishInFlightRef.current || activeRecording) return;
    busyRecovery.current = true; setRecovering(true); setOperationError(null);
    let releaseLease: (() => void) | undefined;
    try {
      releaseLease = await acquireRecordingLease(candidate.id);
      const current = (await listDiscussionDrafts()).find(draft => draft.id === candidate.id);
      if (!current) throw new Error('Recording is no longer available on this device.');
      await exportLocalRecording(current);
    }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setOperationError(error instanceof Error ? error.message : copy.saveFailed); }
    finally { releaseLease?.(); busyRecovery.current = false; setRecovering(false); }
  };
  useEffect(() => {
    const open = () => { void recorder.refreshRecoverableDrafts(); setShowRecoveries(true); };
    window.addEventListener('open-recording-recoveries', open);
    return () => window.removeEventListener('open-recording-recoveries', open);
  }, [recorder.refreshRecoverableDrafts]);
  if (showRecoveries) return <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={copy.recoveredTitle}>
    <section className="flex h-[min(40rem,85vh)] w-[min(40rem,95vw)] flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel">
      <header className="flex items-center justify-between border-b border-edge p-4"><h2>{copy.recoveredTitle}</h2><Button onClick={() => setShowRecoveries(false)}>{copy.close}</Button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {operationError ? <p role="alert" className="mb-3 text-danger">{operationError}</p> : null}
        {!recorder.recoverableDrafts.length ? <p>{language === 'zh' ? '没有待恢复录音' : 'No recordings to recover'}</p> : null}
        {recorder.recoverableDrafts.map(candidate => <article key={candidate.id} className="mb-3 rounded-lg border border-edge p-3">
          <p>{new Date(candidate.startedAt).toLocaleString()} · {candidate.id.slice(0, 8)}</p>
          <p className="text-xs text-fg-muted">{candidate.gatewayUrl ?? (language === 'zh' ? '旧版录音 · 当前 Gateway' : 'Legacy recording · current Gateway')} · {candidate.state === 'upload_failed' ? copy.status.failed : candidate.sealRequested ? copy.status.verifying : copy.status.pending}</p>
          <p className="text-sm">{language === 'zh' ? '本机已保存' : 'Saved locally'} · {verifiedSavedThrough(candidate) !== null ? formatDuration(verifiedSavedThrough(candidate)!) : language === 'zh' ? '时长待核实' : 'duration unverified'} · {formatDuration(candidate.durationMs)} {language === 'zh' ? '录制时长（中断处可能缺失）' : 'capture duration (may contain interruptions)'}</p>
          {candidate.epochs?.slice(1).map(epoch => <p key={epoch.firstChunk} className="text-xs text-fg-muted">{language === 'zh' ? '中断后续录' : 'Resumed after interruption'} · {new Date(epoch.previousEndedAt ?? epoch.startedAt).toLocaleString()} → {new Date(epoch.startedAt).toLocaleString()}</p>)}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={recovering || finishing || activeRecording} onClick={() => void recoverDraft(candidate).then(() => setShowRecoveries(false))}>{copy.recover}</Button>
            <Button disabled={recovering || finishing || activeRecording || candidate.sealRequested} onClick={() => void continueDraft(candidate)}>{language === 'zh' ? '继续录制' : 'Continue recording'}</Button>
            <Button disabled={recovering || finishing || activeRecording} onClick={() => void exportDraft(candidate)}>{language === 'zh' ? '导出原音包' : 'Export originals'}</Button>
            <Button disabled={recovering || finishing || activeRecording} onClick={() => void discardRecoveredDraft(candidate)}>{language === 'zh' ? '丢弃本机副本' : 'Discard local copy'}</Button>
          </div>
        </article>)}
      </div>
    </section>
  </div>;

  if (!visible) {
    if (backgroundUploading || locallyFinalized) return null;
    const candidate = recorder.recoverableDrafts[0];
    if (!candidate) return null;
    return (
      <aside className="fixed bottom-5 right-5 z-[125] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-edge bg-surface-panel p-4 shadow-elevated">
        <button className="text-sm font-medium text-fg" onClick={() => setShowRecoveries(true)}>{copy.recoveredTitle} ({recorder.recoverableDrafts.length})</button>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{copy.recoveredDescription}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" disabled={recovering || finishing || activeRecording} onClick={() => void discardRecoveredDraft()}>
            {copy.discard}
          </Button>
          <Button variant="primary" disabled={recovering || finishing || activeRecording} onClick={() => void recoverDraft()}>
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

  const active = ['recording', 'paused', 'requesting_permission', 'waiting_for_audio'].includes(recorder.phase);
  if (!active && (finishing || locallyFinalized || recorder.phase === 'stopping' || recorder.phase === 'error')) {
    const input = recordingOutcomeInput(detail, status.localComplete ? 'complete' : localReleased ? 'unknown' : recorder.phase === 'stopping' ? 'saving' : (recorder.draft ?? locallyFinalized)?.chunkCount ? 'partial' : 'failed', status.sync);
    const retryOutcome = async (mode: string) => {
      if (outcomeBusy || finishing || recovering) return;
      setOutcomeBusy(true); setOperationError(null);
      try {
        if (mode === 'sync' || mode === 'recover') await recoverDraft(recorder.draft ?? locallyFinalized ?? undefined);
        else if (detail) setDetail(mode === 'analyze' ? await fetchJson<DiscussionDetail>(apiUrl(`/api/discussions/${encodeURIComponent(detail.discussion.id)}/organize`),{ method: 'POST',body: '{}' }) : await retryDiscussion(detail.discussion.id, mode === 'regenerate' ? 'from_audio' : 'resume'));
      } catch (error) { setOperationError(String(error)); }
      finally { setOutcomeBusy(false); }
    };
    return <RecordingFloatingPanel compact={compact} onCompactChange={setCompact} language={language} title={language === 'zh' ? '录音已结束' : 'Recording ended'} subtitle={formatDuration(recorder.elapsedMs)}>
      <div className="p-3"><RecordingOutcomeCard input={input} zh={language === 'zh'} compact={compact} busy={outcomeBusy || finishing || recovering} onRetry={mode => void retryOutcome(mode)}>
        {annotationSyncFailed ? <div className="text-xs text-fg-muted"><p>{language === 'zh' ? '重点同步未完成，原音和笔记处理不受影响。' : 'Highlights are not synced yet. Audio and note processing are unaffected.'}</p><Button disabled={outcomeBusy || finishing || recovering} onClick={() => void (async () => {
          if (!detail || !locallyFinalized || outcomeBusy) return;
          setOutcomeBusy(true);
          try { await syncDiscussionAnnotations(locallyFinalized.id,detail.discussion.id); setAnnotationSyncFailed(false); if (detail.discussion.audioAttachmentId && !detail.discussion.audioDeletedAt) { await recorder.discard(locallyFinalized.id); setLocalReleased(true); } }
          catch (error) { setOperationError(String(error)); } finally { setOutcomeBusy(false); }
        })()}>{language === 'zh' ? '重试重点同步' : 'Retry highlights'}</Button></div> : null}
        {operationError ? <details className="text-xs text-danger"><summary>{language === 'zh' ? '操作未完成，查看详情' : 'Action incomplete. View details'}</summary>{operationError}</details> : null}
        <div className="flex flex-wrap gap-2">
          {!localReleased && recorder.draft && recorder.draft.saveOutcome !== 'complete' && !recorder.draft.sealRequested && !finishing ? <Button disabled={recovering || outcomeBusy} onClick={() => void continueDraft(recorder.draft!)}>{language === 'zh' ? '继续录制' : 'Continue recording'}</Button> : null}
          {detail ? <Button onClick={openNote}>{copy.openNote}</Button> : null}
          {!localReleased && !!recorder.draft?.chunkCount && !finishing ? <Button onClick={() => void exportDraft(recorder.draft!)}>{language === 'zh' ? '导出已录内容' : 'Export saved audio'}</Button> : null}
          {status.localComplete || input.audioAvailable || input.localSave === 'failed' ? <Button onClick={() => setVisible(false)}>{input.localSave === 'failed' ? copy.close : language === 'zh' ? '稍后查看' : 'View later'}</Button> : null}
        </div>
      </RecordingOutcomeCard></div>
    </RecordingFloatingPanel>;
  }
  const inferredProject = detail?.discussion.projectId && detail.discussion.projectInferenceSource !== 'context';
  const zh = language === 'zh';
  const captureLabel = status.capture === 'recording' ? (zh ? '录音中' : 'Recording') : copy.status[status.capture];
  const title = detail?.note.title && !/^Discussion [·•]/.test(detail.note.title) ? detail.note.title : (zh ? '语音笔记' : 'Voice note');
  const controls = (small: boolean) => <>
    {recorder.phase === 'recording' ? <Button className={small ? 'size-10 shrink-0 px-0 shadow-none' : 'min-w-0 whitespace-nowrap shadow-none'} title={zh ? '标重点' : 'Highlight'} aria-label={zh ? '标重点' : 'Highlight'} onClick={() => void recorder.mark()}><Bookmark className="size-4 shrink-0" aria-hidden />{!small ? (zh ? '标重点' : 'Highlight') : null}</Button> : null}
    {recorder.phase === 'recording' || recorder.phase === 'waiting_for_audio' ? <Button className={small ? 'size-10 shrink-0 px-0 shadow-none' : 'min-w-0 whitespace-nowrap shadow-none'} aria-label={copy.pause} title={copy.pause} onClick={recorder.pause}><Pause className="size-4 shrink-0" aria-hidden />{!small ? copy.pause : null}</Button> : null}
    {recorder.phase === 'paused' ? <Button className={small ? 'size-10 shrink-0 px-0 shadow-none' : 'min-w-0 whitespace-nowrap shadow-none'} aria-label={copy.resume} title={copy.resume} onClick={recorder.resume}><Play className="size-4 shrink-0" aria-hidden />{!small ? copy.resume : null}</Button> : null}
    {['recording','waiting_for_audio','paused'].includes(recorder.phase) ? <Button variant="primary" className={small ? 'size-10 shrink-0 px-0' : 'min-w-0 whitespace-nowrap'} aria-label={copy.stop} title={copy.stop} disabled={finishing} onClick={() => void finish()}><Square className="size-4 shrink-0" aria-hidden />{!small ? copy.stop : null}</Button> : null}
  </>;
  const warning = operationError ?? recorder.error ?? recorder.markerError;
  const warningLabel = status.capture === 'interrupted' ? (zh ? '录音已中断，请展开查看已保存内容。' : 'Recording interrupted. Review the saved content.')
    : recorder.markerError ? (zh ? '重点未能保存，请稍后重试。' : 'Highlight could not be saved. Try again.')
    : status.sync === 'failed' ? (zh ? '暂时无法同步，请稍后重试。' : 'Sync is unavailable. Please try again later.')
    : (zh ? '操作未完成，请查看详情。' : 'Could not complete this action. View details.');
  return <RecordingFloatingPanel compact={compact} onCompactChange={setCompact} language={language}
    title={compact ? <span className="font-mono">{formatDuration(recorder.elapsedMs)}</span> : <span className="flex items-center gap-2"><span className={`size-2 shrink-0 rounded-full ${status.capture === 'recording' ? 'bg-danger' : 'bg-accent'}`} aria-hidden />{captureLabel}</span>}
    subtitle={compact ? captureLabel : title} compactActions={controls(true)}>
    {compact ? <>
      <RecordingStatusPanel status={status} language={language} compact />
      {status.capture === 'interrupted' || warning ? <p role="alert" className="px-3 pb-2 text-xs text-danger">{warningLabel}</p> : null}
      {recorder.markerMessage ? <p role="status" className="px-3 pb-2 text-xs text-accent-fg">{zh ? '已标记重点' : 'Highlight saved'}</p> : null}
    </> : <>
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-[2.5rem] leading-none tabular-nums tracking-tight text-fg">{formatDuration(recorder.elapsedMs)}</p>
          {status.capture === 'recording' ? <div className="flex items-center gap-2 text-xs text-fg-muted">
            {recorder.inputLevel != null ? <div role="meter" aria-label={copy.status.level} aria-valuemin={0} aria-valuemax={1} aria-valuenow={recorder.inputLevel} className="flex h-6 items-center gap-0.5">{[0,1,2,3,4].map(index => <span key={index} className={`w-1 rounded-full ${recorder.inputLevel! > index * .12 ? 'bg-accent' : 'bg-surface-active'}`} style={{ height: 6 + Math.min(1,recorder.inputLevel! * 3) * (index % 2 ? 10 : 18) }} />)}</div> : null}
            <span>{recorder.inputLevel == null ? copy.status.levelUnknown : (zh ? '声音输入' : 'Sound input')}</span>
          </div> : null}
        </div>
        <RecordingStatusPanel status={status} language={language} />
        {status.sync === 'offline' ? <p role="status" className="rounded-lg bg-surface-inset px-3 py-2 text-xs leading-5 text-fg-muted">{zh ? '离线录音，联网后自动同步。' : 'Recording offline. Sync resumes when connected.'}</p> : null}
        {status.ai === 'textDelayed' ? <p className="text-xs leading-5 text-fg-muted">{copy.status.textDelayed}</p> : null}
        <details className="group rounded-xl bg-surface-inset px-3 py-2.5">
          <summary className="cursor-pointer text-xs font-medium text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-accent">{zh ? '查看实时文字' : 'Live transcript'}</summary>
          <div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-fg">{transcript?.text || (recorder.liveTranscriptionAvailable ? (zh ? '说话后，文字会陆续显示。' : 'Text will appear as you speak.') : copy.liveUnavailable)}</div>
        </details>
        {inferredProject ? <div className="flex items-center justify-between gap-3 text-xs text-fg-muted"><span>{copy.projectLinked}</span><button type="button" className="inline-flex min-h-8 shrink-0 items-center gap-1 text-accent-fg" onClick={() => void unlinkProject()}><Unlink className="size-3" aria-hidden />{copy.undo}</button></div> : null}
        {finishing && uploadProgress > 0 ? <div role="progressbar" aria-label={zh ? '备份录音' : 'Recording backup'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadProgress)} className="h-1.5 overflow-hidden rounded-full bg-surface-hover"><div className="h-full bg-accent motion-safe:transition-[width]" style={{ width: `${uploadProgress}%` }} /></div> : null}
        {recorder.markerMessage ? <p role="status" className="text-xs text-accent-fg">{zh ? '已标记重点，可稍后回听。' : 'Highlight saved for review.'}</p> : null}
        {warning ? <div role="alert"><details className="text-sm leading-5 text-danger"><summary className="cursor-pointer">{warningLabel}</summary><p className="mt-2 break-words text-xs text-fg-muted">{warning}</p></details></div> : null}
      </div>
      <footer className="space-y-2 border-t border-edge-subtle px-4 py-3">
        <div className="grid grid-flow-col auto-cols-fr gap-2">{controls(false)}</div>
        {(recorder.phase === 'error' || recorder.phase === 'stopped') && recorder.draft && !finishing ? <div className="flex flex-wrap gap-2">
          <Button disabled={recovering || finishing || activeRecording} onClick={() => void recoverDraft(recorder.draft!)}>{copy.recover}</Button>
          <Button disabled={recovering || finishing || activeRecording || recorder.draft.sealRequested} onClick={() => void continueDraft(recorder.draft!)}>{zh ? '继续录制' : 'Continue recording'}</Button>
          <Button disabled={recovering || finishing || activeRecording} onClick={() => void exportDraft(recorder.draft!)}>{zh ? '导出原音包' : 'Export originals'}</Button>
        </div> : null}
        <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
          <span className="whitespace-nowrap">{copy.maxDuration}</span>
          <div className="flex items-center gap-2">
            {detail ? <button type="button" className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap text-accent-fg" onClick={openNote}><FileText className="size-3.5" aria-hidden />{copy.openNote}</button> : null}
            {!active && (!finishing || status.localComplete) ? <button type="button" className="min-h-9 rounded px-2 hover:bg-surface-hover" aria-label={copy.close} onClick={() => setVisible(false)}>{copy.close}</button> : null}
          </div>
        </div>
      </footer>
    </>}
  </RecordingFloatingPanel>;
}
