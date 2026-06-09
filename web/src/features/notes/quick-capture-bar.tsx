import { Image, Mic, Send, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

export type QuickCaptureBarProps = {
  placeholder: string;
  sendLabel: string;
  onCapture: (text: string) => Promise<void>;
  onImagePick?: () => void;
  /** Record audio and upload when stopped. */
  onVoiceCapture?: (file: File, durationSec: number) => Promise<void>;
  recordingLabel?: string;
  imageDisabled?: boolean;
  voiceDisabled?: boolean;
};

const MAX_RECORDING_MS = 30_000;

function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function QuickCaptureBar({
  placeholder,
  sendLabel,
  onCapture,
  onImagePick,
  onVoiceCapture,
  recordingLabel = 'Recording…',
  imageDisabled = false,
  voiceDisabled = false,
}: QuickCaptureBarProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupRecording = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setRecordingSec(0);
  }, []);

  useEffect(() => () => cleanupRecording(), [cleanupRecording]);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;

    setVoiceBusy(true);
    await new Promise<void>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => resolve(),
        { once: true },
      );
      recorder.stop();
    });

    const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    const mimeType = recorder.mimeType || pickAudioMimeType() || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mimeType });
    cleanupRecording();

    if (blob.size > 0 && onVoiceCapture) {
      const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType });
      try {
        await onVoiceCapture(file, durationSec);
      } finally {
        setVoiceBusy(false);
      }
      return;
    }

    setVoiceBusy(false);
  }, [cleanupRecording, onVoiceCapture]);

  const startRecording = useCallback(async () => {
    if (!onVoiceCapture || voiceBusy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.start();
      setRecording(true);
      setRecordingSec(0);
      tickRef.current = setInterval(() => {
        setRecordingSec(Math.round((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      maxTimerRef.current = setTimeout(() => {
        void stopRecording();
      }, MAX_RECORDING_MS);
    } catch {
      cleanupRecording();
    }
  }, [cleanupRecording, onVoiceCapture, recording, stopRecording, voiceBusy]);

  const handleVoiceClick = useCallback(() => {
    if (recording) {
      void stopRecording();
      return;
    }
    void startRecording();
  }, [recording, startRecording, stopRecording]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    try {
      await onCapture(trimmed);
    } catch {
      setText(trimmed);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [text, sending, onCapture]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  const busy = sending || voiceBusy;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-2xl border border-edge bg-surface-panel px-2 py-2 shadow-float dark:shadow-elevated',
        'focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
        recording && 'border-danger ring-1 ring-danger/40',
      )}
    >
      {onImagePick && (
        <button
          type="button"
          onClick={onImagePick}
          disabled={busy || imageDisabled || recording}
          className="shrink-0 rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Image"
        >
          <Image className="h-4 w-4" />
        </button>
      )}
      {onVoiceCapture && (
        <button
          type="button"
          onClick={handleVoiceClick}
          disabled={busy || voiceDisabled || sending}
          className={cn(
            'shrink-0 rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            recording
              ? 'bg-danger-soft text-danger hover:bg-danger-soft'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
          )}
          aria-label={recording ? 'Stop recording' : 'Voice'}
          aria-pressed={recording}
        >
          {recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}
        </button>
      )}
      {recording ? (
        <span className="min-w-0 flex-1 truncate py-1.5 text-sm text-danger">
          {recordingLabel.replace('{{seconds}}', String(recordingSec))}
        </span>
      ) : (
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={busy}
          className="min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 text-fg placeholder:text-fg-muted focus:outline-none disabled:opacity-60"
          style={{ fieldSizing: 'content' }}
        />
      )}
      <button
        type="button"
        disabled={!text.trim() || busy || recording}
        onClick={() => void handleSubmit()}
        aria-label={sendLabel}
        className={cn(
          'shrink-0 rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          text.trim() && !busy && !recording
            ? 'text-accent hover:bg-accent-soft'
            : 'text-fg-disabled',
        )}
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
