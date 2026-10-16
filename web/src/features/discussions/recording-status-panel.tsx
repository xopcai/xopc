import { ChevronDown } from 'lucide-react';
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
  const copy = messages(language).notes.discussionCapture.status; const zh = language === 'zh';
  const savedText = recordingSaveLabel(status,language);
  if (compact) return <p className={`px-3 pb-2 text-xs ${status.save === 'saveFailed' ? 'text-danger' : 'text-fg-muted'}`}>{status.sync === 'offline' ? (zh ? '离线录音 · ' : 'Recording offline · ') : ''}{savedText}</p>;
  return <section aria-label={copy.label} className="space-y-2 text-xs text-fg-muted">
    {status.localComplete ? <p role="status" className="font-medium leading-5 text-fg">{copy.localComplete}</p> : null}
    {status.hasInterruptions ? <p>{zh ? '包含中断与续录；中断期间没有录音。' : 'Contains interruptions and resumed audio. Nothing was captured during the interruptions.'}</p> : null}
    <details className="group">
      <summary className={`flex cursor-pointer list-none items-center gap-2 py-1 outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-accent ${status.save === 'saveFailed' ? 'text-danger' : ''}`}>
        <span className="min-w-0 flex-1 leading-5">{status.localComplete ? (zh ? '查看保存与整理进度' : 'View saving and summary progress') : savedText}</span>
        <span className="shrink-0 text-fg-muted">{zh ? '详情' : 'Details'}</span><ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-lg bg-surface-inset p-3 leading-5">
        <dt>{zh ? '录音' : 'Recording'}</dt><dd>{copy[status.capture]}</dd>
        <dt>{zh ? '本机保存' : 'On this device'}</dt><dd>{savedText}</dd>
        <dt>{zh ? '云端备份' : 'Cloud backup'}</dt><dd>{status.sync === 'pending' ? (zh ? '录音结束后自动备份' : 'Backs up after recording') : copy[status.sync]}</dd>
        <dt>{zh ? '文字与笔记' : 'Text and notes'}</dt><dd>{status.ai === 'waitingSource' ? (zh ? '录音保存后继续整理' : 'Continues after the recording is saved') : copy[status.ai]}</dd>
      </dl>
      {status.timingUncertain ? <p className="mt-2 leading-5">{copy.timingPending}</p> : null}
      {status.localComplete && status.sync !== 'available' ? <p className="mt-2 leading-5">{copy.leaveHint}</p> : null}
    </details>
  </section>;
}
