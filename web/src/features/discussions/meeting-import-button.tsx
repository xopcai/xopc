import * as Dialog from '@radix-ui/react-dialog';
import { DISCUSSION_AUDIO_MAX_BYTES } from '@xopcai/gateway-contract';
import { Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';

import { acknowledgeDiscussionConsent, createDiscussion, getDiscussionCaptureSettings } from './discussion-api';
import { deleteDiscussionDraft, saveDiscussionDraft } from './discussion-draft-store';
import type { DiscussionDraft } from './discussion-types';
import { persistMeetingImport, uploadDraftRecording } from './recording-upload';

export function MeetingImportButton({ projectId, compact = false }: { projectId?: string; compact?: boolean }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<{ file: File; requestId: string; projectId?: string; draft?: DiscussionDraft } | null>(null);
  const uploading = useRef(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<number | null>(null);

  async function upload(consentVersion?: number) {
    const item = pending.current;
    if (!item || uploading.current) return;
    uploading.current = true;
    setProgress(0);
    setVerifying(false);
    setError(null);
    try {
      if (consentVersion !== undefined) await acknowledgeDiscussionConsent(consentVersion);
      const settings = await getDiscussionCaptureSettings();
      if (settings.consentAcknowledgedAt == null) {
        setConsent(settings.consentPolicyVersion);
        return;
      }
      setConsent(null);
      item.draft ??= await persistMeetingImport(item.file, item.requestId);
      const detail = await createDiscussion({
        clientRequestId: item.requestId, contextProjectId: item.projectId, source: 'web',
        consentPolicyVersion: settings.consentPolicyVersion, recordedAt: item.draft.startedAt,
      });
      const draft = { ...item.draft, serverDiscussionId: detail.discussion.id, projectId: item.projectId };
      await saveDiscussionDraft(draft);
      await uploadDraftRecording(draft, detail.discussion.id, setProgress, true, stage => setVerifying(stage === 'verifying'));
      await deleteDiscussionDraft(item.requestId);
      pending.current = null;
      navigate(`/notes/${encodeURIComponent(detail.note.id)}`);
    } catch (caught) {
      setError(caught instanceof Error && caught.message === 'Unsupported audio format'
        ? (zh ? '请选择 MP3、M4A、WAV、OGG 或 WebM 音频。' : 'Choose an MP3, M4A, WAV, OGG, or WebM file.')
        : (zh ? '上传未完成，请重试。' : 'Upload incomplete. Try again.'));
    } finally {
      uploading.current = false;
      setProgress(null);
      setVerifying(false);
    }
  }

  const label = zh ? '上传音频' : 'Upload audio';
  const status = verifying ? (zh ? '正在确认音频' : 'Verifying audio')
    : progress !== null ? (zh ? `上传中 ${progress}%` : `Uploading ${progress}%`) : label;
  return <div className={compact ? 'relative inline-flex' : 'flex min-w-0 flex-col'}>
    <input ref={input} hidden type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,audio/webm,.mp3,.m4a,.wav,.ogg,.webm" onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!file.size || file.size > DISCUSSION_AUDIO_MAX_BYTES) {
        pending.current = null;
        setError(zh ? '请选择小于或等于 1 GiB 的非空音频。' : 'Choose a non-empty audio file up to 1 GiB.');
        return;
      }
      pending.current = { file, requestId: crypto.randomUUID(), projectId };
      void upload();
    }} />
    <button ref={trigger} type="button" aria-label={status} title={label} disabled={progress !== null}
      className={`inline-flex items-center gap-3 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 ${compact
        ? 'size-11 shrink-0 justify-center rounded-lg text-fg-muted'
        : 'min-h-20 flex-1 rounded-xl border border-edge bg-surface-panel p-4 text-sm font-semibold text-fg'}`}
      onClick={() => input.current?.click()}>
      {progress !== null ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : <Upload className={compact ? 'size-4' : 'size-5 shrink-0 text-fg-muted'} aria-hidden />}
      {compact ? <span className="sr-only" role="status">{status}</span> : <span role="status">{status}</span>}
    </button>
    {error ? <div className={`rounded-lg border border-edge bg-surface-panel p-2 text-xs text-danger ${compact ? 'absolute right-0 top-full z-20 w-56 shadow-popover' : 'mt-2'}`}>
      <span role="alert">{error}</span>
      {pending.current ? <Button variant="ghost" onClick={() => void upload()}>{zh ? '重试' : 'Retry'}</Button> : null}
    </div> : null}
    <Dialog.Root open={consent !== null} onOpenChange={open => { if (!open && !uploading.current) setConsent(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[90] bg-scrim" />
        <Dialog.Content onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}
          className="xopc-dialog-content fixed left-1/2 top-1/2 z-[91] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-overlay p-5 text-fg shadow-popover">
          <Dialog.Title className="font-semibold">{label}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-fg-muted">{zh ? '请确认你有权上传此录音，并允许语音服务转写。' : 'Confirm you have permission to upload and transcribe this recording.'}</Dialog.Description>
          {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild><Button disabled={progress !== null}>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close>
            <Button variant="primary" disabled={progress !== null} onClick={() => { if (consent !== null) void upload(consent); }}>{zh ? '确认上传' : 'Confirm upload'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
