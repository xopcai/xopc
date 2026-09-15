import { DISCUSSION_AUDIO_MAX_BYTES } from '@xopcai/gateway-contract';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useLocaleStore } from '@/stores/locale-store';

import { acknowledgeDiscussionConsent, createDiscussion, getDiscussionCaptureSettings } from './discussion-api';
import { persistMeetingImport, uploadDraftRecording } from './recording-upload';
import { deleteDiscussionDraft, saveDiscussionDraft } from './discussion-draft-store';

export function MeetingImportButton({ projectId }: { projectId?: string }) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<{ file: File; requestId: string; discussionId?: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<number | null>(null);
  async function upload() {
    const item = pending.current;
    if (!item || progress !== null) return;
    setProgress(0);
    setError(null);
    try {
      const settings = await getDiscussionCaptureSettings();
      if (settings.consentAcknowledgedAt == null) { setConsent(settings.consentPolicyVersion); return; }
      const draft = await persistMeetingImport(item.file, item.requestId);
      const detail = await createDiscussion({ clientRequestId: item.requestId, contextProjectId: projectId, source: 'web', consentPolicyVersion: settings.consentPolicyVersion });
      item.discussionId = detail.discussion.id;
      await saveDiscussionDraft({ ...draft, serverDiscussionId: detail.discussion.id, projectId });
      if (!detail.discussion.audioAttachmentId) await uploadDraftRecording(draft, detail.discussion.id, setProgress);
      await deleteDiscussionDraft(item.requestId);
      pending.current = null;
      navigate(`/notes/${encodeURIComponent(detail.note.id)}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setProgress(null); }
  }
  return <div className="inline-flex flex-wrap items-center gap-2 text-xs">
    <input ref={input} hidden type="file" accept="audio/*,.m4a,.wav,.mp3,.webm,.ogg" onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!file.size || file.size > DISCUSSION_AUDIO_MAX_BYTES) { setError(zh ? '音频须为 1 字节至 1 GiB' : 'Audio must be between 1 byte and 1 GiB'); return; }
      pending.current = { file, requestId: crypto.randomUUID() };
      void upload();
    }} />
    <button type="button" className="inline-flex items-center gap-1 rounded-md p-2 hover:bg-surface-hover" disabled={progress !== null} onClick={() => error && pending.current ? void upload() : input.current?.click()}>
      <Upload className="size-3.5" />{progress !== null ? `${progress}%` : error && pending.current ? (zh ? '重试导入' : 'Retry import') : (zh ? '导入录音' : 'Import recording')}
    </button>
    {consent !== null ? <span>{zh ? '请确认你有权上传此录音，并允许配置的语音服务处理。' : 'Confirm permission to upload this recording and process it with your configured speech service.'}<button type="button" className="p-2 text-accent" onClick={() => void acknowledgeDiscussionConsent(consent).then(() => { setConsent(null); return upload(); }).catch((caught) => setError(String(caught)))}>{zh ? '确认导入' : 'Confirm import'}</button></span> : null}
    {error ? <span role="alert" className="text-danger">{error}</span> : null}
  </div>;
}
