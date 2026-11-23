import { Check, Loader2, Mic, Pause, Play, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { formatVoiceMemoLabel, noteAttachmentRef } from '@/features/notes/note-media';
import { rebuildNoteAgentContext, uploadNoteMedia, type NoteAttachment } from '@/features/notes/notes-api';
import { useLocaleStore } from '@/stores/locale-store';

export interface InlineVoiceRecorderProps {
  noteId: string;
  onInserted: (payload: { attachment: NoteAttachment; href: string; label: string }) => void;
  onCancel: () => void;
}

function pickSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'audio/webm';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((item) => MediaRecorder.isTypeSupported(item)) ?? 'audio/webm';
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function formatClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export function InlineVoiceRecorder({ noteId, onInserted, onCancel }: InlineVoiceRecorderProps) {
  const zh = useLocaleStore((s) => s.language === 'zh');
  const [status, setStatus] = useState<'starting' | 'recording' | 'paused' | 'saving' | 'error'>('starting');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const accumulatedMsRef = useRef<number>(0);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setStatus('error');
        setErrorMessage(zh ? '当前环境不支持麦克风录音' : 'Microphone recording is not supported');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const mimeType = pickSupportedAudioMimeType();
        const recorder = new MediaRecorder(stream, { mimeType });
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };
        recorder.start(250);
        recorderRef.current = recorder;
        startedAtRef.current = Date.now();
        accumulatedMsRef.current = 0;
        setStatus('recording');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(
          err instanceof Error ? err.message : zh ? '无法访问麦克风权限' : 'Microphone access denied',
        );
      }
    }
    void start();
    return () => {
      cancelled = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      stopTracks();
    };
  }, [stopTracks, zh]);

  useEffect(() => {
    if (status !== 'recording') return;
    const timer = window.setInterval(() => {
      const totalMs = accumulatedMsRef.current + (Date.now() - startedAtRef.current);
      setElapsedSec(Math.floor(totalMs / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [status]);

  const handleTogglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      accumulatedMsRef.current += Date.now() - startedAtRef.current;
      setStatus('paused');
    } else if (recorder.state === 'paused') {
      recorder.resume();
      startedAtRef.current = Date.now();
      setStatus('recording');
    }
  };

  const handleFinish = async () => {
    const recorder = recorderRef.current;
    if (!recorder || status === 'saving') return;
    const totalMs =
      status === 'recording'
        ? accumulatedMsRef.current + (Date.now() - startedAtRef.current)
        : accumulatedMsRef.current;
    const durationSec = Math.max(1, Math.round(totalMs / 1000));

    setStatus('saving');
    setErrorMessage(null);

    try {
      await new Promise<void>((resolve) => {
        if (recorder.state === 'inactive') {
          resolve();
          return;
        }
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
      stopTracks();

      const mimeType = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const ext = extensionForMime(mimeType);
      const file = new File([blob], `voice-clip-${Date.now()}.${ext}`, { type: mimeType });
      const attachment = await uploadNoteMedia(noteId, file);
      const href = noteAttachmentRef(noteId, attachment.id);
      const label = formatVoiceMemoLabel(durationSec);
      void rebuildNoteAgentContext(noteId).catch(() => undefined);
      onInserted({ attachment, href, label });
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : zh ? '保存语音片段失败' : 'Failed to save audio clip');
    }
  };

  const handleDiscard = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    stopTracks();
    onCancel();
  };

  return (
    <div
      role="region"
      aria-label={zh ? '内联语音录制' : 'Inline voice recording'}
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-edge-subtle bg-accent-soft/45 px-4 py-2 text-xs"
    >
      <div className="flex items-center gap-2.5">
        <span
          className={
            status === 'recording'
              ? 'inline-block size-2.5 animate-pulse rounded-full bg-danger'
              : 'inline-block size-2.5 rounded-full bg-fg-muted'
          }
          aria-hidden
        />
        <Mic className="size-3.5 text-accent-fg" aria-hidden />
        <span className="font-medium text-fg">
          {status === 'starting'
            ? zh
              ? '正在准备麦克风…'
              : 'Starting microphone…'
            : status === 'saving'
              ? zh
                ? '正在嵌入语音并触发后台转写…'
                : 'Uploading clip & queuing transcription…'
              : status === 'paused'
                ? zh
                  ? '录音已暂停'
                  : 'Recording paused'
                : status === 'error'
                  ? errorMessage ?? (zh ? '录音失败' : 'Recording failed')
                  : zh
                    ? '正在录制音频片段'
                    : 'Recording audio clip'}
        </span>
        {(status === 'recording' || status === 'paused' || status === 'saving') ? (
          <span className="rounded bg-surface-panel px-1.5 py-0.5 font-mono tabular-nums text-fg">
            {formatClock(elapsedSec)}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        {(status === 'recording' || status === 'paused') ? (
          <>
            <button
              type="button"
              onClick={handleTogglePause}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-edge bg-surface-panel px-2.5 text-xs text-fg hover:bg-surface-hover"
            >
              {status === 'recording' ? (
                <>
                  <Pause className="size-3" aria-hidden />
                  <span>{zh ? '暂停' : 'Pause'}</span>
                </>
              ) : (
                <>
                  <Play className="size-3" aria-hidden />
                  <span>{zh ? '继续' : 'Resume'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void handleFinish()}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-medium text-on-accent hover:bg-accent-hover"
            >
              <Check className="size-3.5" aria-hidden />
              <span>{zh ? '完成嵌入' : 'Insert clip'}</span>
            </button>
          </>
        ) : status === 'saving' ? (
          <Loader2 className="size-4 animate-spin text-accent-fg" aria-hidden />
        ) : null}

        <button
          type="button"
          disabled={status === 'saving'}
          onClick={handleDiscard}
          aria-label={zh ? '取消录音' : 'Cancel recording'}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-40"
        >
          <X className="size-3.5" aria-hidden />
          <span>{zh ? '取消' : 'Cancel'}</span>
        </button>
      </div>
    </div>
  );
}
