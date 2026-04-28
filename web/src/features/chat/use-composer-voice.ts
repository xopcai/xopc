import { useCallback, useEffect, useRef, useState } from 'react';

import type { WireAttachment } from '@/features/chat/composer.types';
import { showComposerNotification } from '@/features/chat/composer-notifications';
import { MAX_CHAT_ATTACHMENTS } from '@/features/chat/attachment-utils';
import type { ChatMessages } from '@/i18n/messages';

async function handleRecordingComplete(
  chunks: Blob[],
  recorderMimeType: string,
  opts: {
    /** Wall-clock elapsed while recording stopped (helps WebM duration in browsers). */
    recordingDurationSec: number;
    wireAttachmentsPayload: () => WireAttachment[];
    getTextValue: () => string;
    getThinkingLevel: () => string;
    isRunBusy: () => boolean;
    onAutoSend: (text: string, atts: WireAttachment[], level: string) => void;
    resetEditor: () => void;
    clearAttachments: () => void;
  },
): Promise<void> {
  if (opts.isRunBusy()) return;
  const blob = new Blob(chunks, { type: recorderMimeType || 'audio/webm' });
  if (blob.size < 32) return;

  const ext = blob.type.includes('webm') ? 'webm' : 'ogg';
  const { loadAttachment } = await import('@/features/chat/attachment-load');
  const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type });
  const voiceAttachment = await loadAttachment(file, file.name);

  const existingPayload = opts.wireAttachmentsPayload();
  const secs = opts.recordingDurationSec;
  const durationSeconds =
    Number.isFinite(secs) && secs >= 0.05 ? Math.round(secs * 1000) / 1000 : undefined;

  const voiceWire: WireAttachment = {
    type: 'voice',
    mimeType: voiceAttachment.mimeType,
    data: voiceAttachment.content,
    name: voiceAttachment.name,
    size: voiceAttachment.size,
    ...(durationSeconds != null ? { durationSeconds } : {}),
  };

  opts.onAutoSend(
    opts.getTextValue(),
    [...existingPayload, voiceWire],
    opts.getThinkingLevel(),
  );
  opts.resetEditor();
  opts.clearAttachments();
}

export interface UseComposerVoiceOptions {
  disabled: boolean;
  runBusy: boolean;
  chat: ChatMessages;
  /** Returns current non-voice attachment count (voice recording not yet in list during record). */
  getAttachmentCount: () => number;
  /** Called when voice recording completes and auto-sends. */
  onAutoSend: (text: string, attachments: WireAttachment[], thinkingLevel: string) => void;
  wireAttachmentsPayload: () => WireAttachment[];
  getTextValue: () => string;
  getThinkingLevel: () => string;
  /** Clears the composer after auto-send. */
  resetEditor: () => void;
  clearAttachments: () => void;
  isRunBusy: () => boolean;
}

export interface UseComposerVoiceReturn {
  voiceRecording: boolean;
  toggleVoiceRecording: () => Promise<void>;
  stopVoiceRecording: () => void;
}

export function useComposerVoice(options: UseComposerVoiceOptions): UseComposerVoiceReturn {
  const {
    disabled,
    runBusy,
    chat: m,
    getAttachmentCount,
    onAutoSend,
    wireAttachmentsPayload,
    getTextValue,
    getThinkingLevel,
    resetEditor,
    clearAttachments,
    isRunBusy,
  } = options;

  const [voiceRecording, setVoiceRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceSkipAutoSendRef = useRef(false);
  /** Captured when MediaRecorder starts — used because WebMs often expose no `<audio.duration`. */
  const recordStartPerfRef = useRef<number | null>(null);

  const onAutoSendRef = useRef(onAutoSend);
  onAutoSendRef.current = onAutoSend;
  const wireRef = useRef(wireAttachmentsPayload);
  wireRef.current = wireAttachmentsPayload;
  const getTextRef = useRef(getTextValue);
  getTextRef.current = getTextValue;
  const getLevelRef = useRef(getThinkingLevel);
  getLevelRef.current = getThinkingLevel;
  const isRunBusyRef = useRef(isRunBusy);
  isRunBusyRef.current = isRunBusy;
  const resetEditorRef = useRef(resetEditor);
  resetEditorRef.current = resetEditor;
  const clearAttRef = useRef(clearAttachments);
  clearAttRef.current = clearAttachments;

  /** Stop mic tracks only after MediaRecorder has finished (`onstop`); stopping tracks right after `stop()` can flush silence or truncate audio on some engines. */
  const stopVoiceMediaStreamTracks = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, []);

  const stopVoiceRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
    } else {
      stopVoiceMediaStreamTracks();
    }
    mediaRecorderRef.current = null;
    setVoiceRecording(false);
  }, [stopVoiceMediaStreamTracks]);

  const toggleVoiceRecording = useCallback(async () => {
    if (runBusy || disabled) return;
    if (voiceRecording) {
      stopVoiceRecording();
      return;
    }
    if (getAttachmentCount() >= MAX_CHAT_ATTACHMENTS) {
      showComposerNotification('warning', m.maxAttachmentsReached, { max: MAX_CHAT_ATTACHMENTS });
      return;
    }
    voiceSkipAutoSendRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const rec = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) mediaChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        void (async () => {
          try {
            if (voiceSkipAutoSendRef.current) {
              voiceSkipAutoSendRef.current = false;
              recordStartPerfRef.current = null;
              return;
            }
            const t0 = recordStartPerfRef.current;
            recordStartPerfRef.current = null;
            const recordingDurationSec =
              typeof t0 === 'number' ? Math.max(0, (performance.now() - t0) / 1000) : 0;

            const chunks = mediaChunksRef.current;
            mediaChunksRef.current = [];
            await handleRecordingComplete(chunks, rec.mimeType, {
              recordingDurationSec,
              wireAttachmentsPayload: () => wireRef.current(),
              getTextValue: () => getTextRef.current(),
              getThinkingLevel: () => getLevelRef.current(),
              isRunBusy: () => isRunBusyRef.current(),
              onAutoSend: (text, atts, level) => onAutoSendRef.current(text, atts, level),
              resetEditor: () => resetEditorRef.current(),
              clearAttachments: () => clearAttRef.current(),
            });
          } finally {
            stopVoiceMediaStreamTracks();
          }
        })();
      };
      mediaRecorderRef.current = rec;
      recordStartPerfRef.current = performance.now();
      rec.start(250);
      setVoiceRecording(true);
    } catch {
      stopVoiceMediaStreamTracks();
      mediaRecorderRef.current = null;
      showComposerNotification('error', m.voiceMicDenied);
    }
  }, [disabled, getAttachmentCount, m.maxAttachmentsReached, m.voiceMicDenied, runBusy, stopVoiceMediaStreamTracks, stopVoiceRecording, voiceRecording]);

  useEffect(() => {
    return () => {
      voiceSkipAutoSendRef.current = true;
      stopVoiceRecording();
    };
  }, [stopVoiceRecording]);

  return { voiceRecording, toggleVoiceRecording, stopVoiceRecording };
}
