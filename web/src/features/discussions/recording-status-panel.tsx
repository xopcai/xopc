import { messages } from '@/i18n/messages';
import type { projectRecordingStatus } from './recording-status';

type RecordingStatus = ReturnType<typeof projectRecordingStatus>;
export function recordingSaveLabel(status: RecordingStatus, language: 'en' | 'zh'): string {
  const zh = language === 'zh'; const copy = messages(language).notes.discussionCapture.status;
  if (status.save === 'saveFailed') return status.savedThroughMs ? `${zh ? '保存遇到问题，已保留至' : 'Save interrupted; retained through'} ${clock(status.savedThroughMs)}` : copy.saveFailed;
  if (status.localComplete) return copy.localComplete;
  if (status.savedThroughMs !== null && status.savedThroughMs > 0) return copy.savedThrough.replace('{{time}}',clock(status.savedThroughMs));
  return status.save === 'savedUnknown' ? (zh ? '原音已暂存，保存时长确认中' : 'Audio retained; checking saved duration') : (zh ? '正在保存录音' : 'Saving recording');
}
function clock(ms: number) { return `${String(Math.floor(ms / 60000)).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}`; }
export function RecordingStatusPanel({ status, language, compact = false }: { status: RecordingStatus; language: 'en' | 'zh'; compact?: boolean }) {
  const copy = messages(language).notes.discussionCapture.status;
  const zh = language === 'zh';
  const savedText = recordingSaveLabel(status, language);

  if (status.save === 'saveFailed') {
    return (
      <p className={`${compact ? 'px-3 pb-2' : ''} text-xs text-danger`}>
        {savedText}
      </p>
    );
  }
  if (status.sync === 'offline') {
    return (
      <p role="status" className={`${compact ? 'px-3 pb-2 text-fg-muted' : 'rounded-lg bg-surface-inset px-2.5 py-1.5 text-fg-muted'} text-xs`}>
        {zh ? '离线录音 · 联网后自动同步' : 'Recording offline · Syncs when connected'}
      </p>
    );
  }
  if (status.localComplete) {
    return (
      <p role="status" className={`${compact ? 'px-3 pb-2 text-fg-muted' : 'font-medium text-fg'} text-xs`}>
        {copy.localComplete}
      </p>
    );
  }
  return null;
}
