import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AudioLines, Image, Mic, Plus, Send, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

export type QuickCaptureBarProps = {
  placeholder: string;
  submitLabel: string;
  actionsLabel: string;
  imageLabel: string;
  voiceLabel: string;
  stopRecordingLabel: string;
  recordingLabel: string;
  discussionCaptureLabel: string;
  onCapture: (text: string) => Promise<void>;
  onImagePick?: () => void;
  /** Record audio and upload when stopped. */
  onVoiceCapture?: (file: File, durationSec: number) => Promise<void>;
  onVoiceError?: () => void;
  imageDisabled?: boolean;
  voiceDisabled?: boolean;
  onDiscussionCapture?: () => void;
};

const MAX_RECORDING_MS = 30_000;

function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function QuickCaptureBar({
  placeholder,
  submitLabel,
  actionsLabel,
  imageLabel,
  voiceLabel,
  stopRecordingLabel,
  onCapture,
  onImagePick,
  onVoiceCapture,
  onVoiceError,
  recordingLabel,
  imageDisabled = false,
  voiceDisabled = false,
  onDiscussionCapture,
  discussionCaptureLabel,
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
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onVoiceError?.();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
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
      onVoiceError?.();
    }
  }, [cleanupRecording, onVoiceCapture, onVoiceError, recording, stopRecording, voiceBusy]);

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
  const hasCaptureActions = Boolean(onImagePick || onVoiceCapture || onDiscussionCapture);

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-2xl border border-edge bg-surface-panel p-2 shadow-float dark:shadow-elevated',
        'focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
        recording && 'border-danger ring-1 ring-danger/40',
      )}
      aria-busy={busy}
    >
      {recording ? (
        <button
          type="button"
          onClick={() => void stopRecording()}
          disabled={voiceBusy}
          className="shrink-0 rounded-lg bg-danger-soft p-2 text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={stopRecordingLabel}
          title={stopRecordingLabel}
          aria-pressed="true"
        >
          <Square className="size-4 fill-current" aria-hidden />
        </button>
      ) : hasCaptureActions ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              disabled={busy}
              className="shrink-0 rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={actionsLabel}
              title={actionsLabel}
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={8}
              className="z-50 min-w-44 rounded-xl border border-edge bg-surface-panel p-1 shadow-popover"
            >
              {onImagePick ? (
                <DropdownMenu.Item
                  disabled={imageDisabled}
                  onSelect={onImagePick}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                >
                  <Image className="size-4 text-fg-muted" aria-hidden />
                  {imageLabel}
                </DropdownMenu.Item>
              ) : null}
              {onVoiceCapture ? (
                <DropdownMenu.Item
                  disabled={voiceDisabled}
                  onSelect={() => void startRecording()}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                >
                  <Mic className="size-4 text-fg-muted" aria-hidden />
                  {voiceLabel}
                </DropdownMenu.Item>
              ) : null}
              {onDiscussionCapture ? (
                <DropdownMenu.Item
                  onSelect={onDiscussionCapture}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
                >
                  <AudioLines className="size-4 text-fg-muted" aria-hidden />
                  {discussionCaptureLabel}
                </DropdownMenu.Item>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
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
          aria-label={placeholder}
          rows={1}
          disabled={busy}
          className="max-h-28 min-h-8 flex-1 resize-none overflow-y-auto bg-transparent py-1.5 text-sm leading-5 text-fg placeholder:text-fg-muted focus:outline-none disabled:opacity-60"
          style={{ fieldSizing: 'content' }}
        />
      )}
      <button
        type="button"
        disabled={!text.trim() || busy || recording}
        onClick={() => void handleSubmit()}
        aria-label={submitLabel}
        title={submitLabel}
        className={cn(
          'shrink-0 rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          text.trim() && !busy && !recording
            ? 'bg-accent text-white hover:bg-accent-hover'
            : 'text-fg-disabled',
        )}
      >
        <Send className="size-4" aria-hidden />
      </button>
    </div>
  );
}
