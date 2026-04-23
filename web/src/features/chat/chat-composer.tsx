import { Ban, File as FileIcon, Mic, Send, Sparkles, Square } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

import type { Attachment } from '@/features/chat/attachment-utils';
import { formatFileSize, MAX_CHAT_ATTACHMENTS } from '@/features/chat/attachment-utils';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '@/features/chat/constants';
import { ChatPendingFollowUpStack } from '@/features/chat/chat-pending-follow-up-stack';
import { SessionWorkingDirectoryControl } from '@/features/chat/session-working-directory-control';
import type { SessionManager } from '@/features/chat/session-manager';
import type { AtMentionItem } from '@/features/chat/at-mention-api';
import { AtMentionPicker } from '@/features/chat/at-mention-picker';
import { CommandPalette } from '@/features/chat/command-palette';
import { MAX_PENDING_FOLLOW_UPS, type PendingFollowUp } from '@/features/chat/pending-follow-up.types';
import type { PaletteItem } from '@/features/chat/command-palette.types';
import {
  applyWireToEditor,
  getWireCaretOffset,
  handleComposerBackspace,
  normalizeOrphanComposerDom,
  serializeEditorToWire,
} from '@/features/chat/composer-editor-wire';
import { detectAtRange, useAtMentionPicker } from '@/features/chat/use-at-mention-picker';
import { detectSlashRange, useCommandPalette } from '@/features/chat/use-command-palette';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

const ACCEPT =
  'image/*,application/pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml,.zip';

const ACCEPT_TOKENS = ACCEPT.split(',')
  .map((t) => t.trim())
  .filter(Boolean);

/** Matches hidden `<input accept={ACCEPT}>`. Exported for unit tests. */
export function isComposerAcceptableFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const nameLower = file.name.toLowerCase();
  for (const token of ACCEPT_TOKENS) {
    const t = token.toLowerCase();
    if (t.endsWith('/*')) {
      const prefix = t.slice(0, -1);
      if (mime.startsWith(prefix)) return true;
    } else if (token.startsWith('.')) {
      if (nameLower.endsWith(token.toLowerCase())) return true;
    } else if (mime === t) {
      return true;
    }
  }
  return false;
}

function fileDedupeKey(f: File): string {
  return `${f.name}\0${f.size}\0${f.lastModified}`;
}

/** Merges `DataTransfer.files` and `kind === 'file'` items; dedupes; skips empty blobs. Exported for unit tests. */
export function collectClipboardFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: File[] = [];
  const add = (f: File | null) => {
    if (!f || f.size === 0) return;
    const key = fileDedupeKey(f);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  const { files } = data;
  if (files?.length) {
    for (let i = 0; i < files.length; i++) {
      add(files.item(i));
    }
  }
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file') {
      add(item.getAsFile());
    }
  }
  return out;
}

const TEXTAREA_MAX_HEIGHT_PX = 128;

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive';

function thinkingIcon(level: ThinkingLevel) {
  return level === 'off' ? Ban : Sparkles;
}

function syncComposerPlaceholderClass(el: HTMLElement, wire: string): void {
  el.classList.toggle('composer-input-empty', wire.length === 0);
}

function wireFollowUpAttachmentsToComposer(
  wire: NonNullable<PendingFollowUp['attachments']>,
): Attachment[] {
  return wire.map((w) => ({
    type:
      w.type === 'voice'
        ? 'voice'
        : (w.mimeType ?? '').startsWith('image/')
          ? 'image'
          : 'document',
    mimeType: w.mimeType ?? 'application/octet-stream',
    content: w.data ?? '',
    name: w.name ?? 'file',
    size: w.size ?? 0,
  }));
}

type ComposerKbdContext = {
  palette: ReturnType<typeof useCommandPalette>;
  atPicker: ReturnType<typeof useAtMentionPicker>;
  replaceRange: (text: string, start: number, end: number, insert: string) => string;
  applyPaletteItem: (item: PaletteItem) => void;
  applyAtMentionItem: (item: AtMentionItem) => void;
  send: () => void;
  runBusy: boolean;
  flushSteeringDraft?: () => void | Promise<void>;
  interruptDraft?: () => void;
  attachmentsLen: number;
  isComposing: boolean;
  valueRef: MutableRefObject<string>;
  setValue: (v: string) => void;
  setCursor: (c: number) => void;
  adjustHeight: () => void;
  editorRef: MutableRefObject<HTMLDivElement | null>;
};

const ChatComposerInput = memo(function ChatComposerInput({
  editorRef,
  disabled,
  placeholder,
  onWireInput,
  adjustHeight,
  processFiles,
  setIsComposing,
  kbdRef,
}: {
  editorRef: MutableRefObject<HTMLDivElement | null>;
  disabled: boolean;
  placeholder: string;
  onWireInput: (wire: string, caret: number) => void;
  adjustHeight: () => void;
  processFiles: (files: File[]) => Promise<void>;
  setIsComposing: (v: boolean) => void;
  kbdRef: MutableRefObject<ComposerKbdContext>;
}) {
  const isComposingRef = useRef(false);
  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck
      className={cn(
        'composer-input box-border m-0 max-h-32 min-h-10 w-full overflow-y-auto border-0 bg-transparent px-0 py-2 text-[0.9375rem] leading-6 text-fg focus:outline-none focus:ring-0 disabled:opacity-50',
        'composer-input-empty',
      )}
      data-placeholder={placeholder}
      onInput={(e) => {
        const el = e.currentTarget;
        const wire = isComposingRef.current ? serializeEditorToWire(el) : normalizeOrphanComposerDom(el);
        syncComposerPlaceholderClass(el, wire);
        onWireInput(wire, getWireCaretOffset(el));
        adjustHeight();
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
        setIsComposing(true);
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
        setIsComposing(false);
        queueMicrotask(() => {
          const el = editorRef.current;
          if (!el || isComposingRef.current) return;
          const wire = normalizeOrphanComposerDom(el);
          syncComposerPlaceholderClass(el, wire);
          onWireInput(wire, getWireCaretOffset(el));
          adjustHeight();
        });
      }}
      onPaste={async (e) => {
        const cd = e.clipboardData;
        const collected = collectClipboardFiles(cd ?? null);
        const accepted = collected.filter(isComposerAcceptableFile);
        if (accepted.length > 0) {
          e.preventDefault();
          await processFiles(accepted);
          return;
        }
        if (collected.length > 0) {
          e.preventDefault();
          console.warn('Clipboard file type not supported for chat attachments');
          return;
        }
        const text = cd?.getData('text/plain');
        if (text) {
          e.preventDefault();
          document.execCommand('insertText', false, text);
        }
      }}
      onKeyDown={(e) => {
        const k = kbdRef.current;
        if (e.key === 'Backspace' && !k.isComposing && editorRef.current) {
          if (handleComposerBackspace(editorRef.current)) {
            e.preventDefault();
            return;
          }
        }
        const { atPicker, palette } = k;
        if (atPicker.open && atPicker.atRange) {
          if (e.key === 'Escape') {
            e.preventDefault();
            const range = atPicker.atRange;
            const v = k.valueRef.current;
            const next = k.replaceRange(v, range.start, range.end, '');
            k.valueRef.current = next;
            k.setValue(next);
            k.setCursor(range.start);
            requestAnimationFrame(() => {
              const el = k.editorRef.current;
              if (el) {
                applyWireToEditor(el, next, range.start);
                syncComposerPlaceholderClass(el, next);
              }
              k.adjustHeight();
            });
            return;
          }
          if (atPicker.items.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              atPicker.onNavigate('down');
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              atPicker.onNavigate('up');
              return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !k.isComposing) {
              e.preventDefault();
              const item = atPicker.items[atPicker.selectedIndex];
              if (item) k.applyAtMentionItem(item);
              return;
            }
          }
        }
        if (palette.open && palette.items.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            palette.onNavigate('down');
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            palette.onNavigate('up');
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey && !k.isComposing) {
            e.preventDefault();
            const item = palette.items[palette.selectedIndex];
            if (item) k.applyPaletteItem(item);
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            const range = palette.slashRange;
            if (range) {
              const v = k.valueRef.current;
              const next = k.replaceRange(v, range.start, range.end, '');
              k.valueRef.current = next;
              k.setValue(next);
              k.setCursor(range.start);
              requestAnimationFrame(() => {
                const el = k.editorRef.current;
                if (el) {
                  applyWireToEditor(el, next, range.start);
                  syncComposerPlaceholderClass(el, next);
                }
                k.adjustHeight();
              });
            }
            return;
          }
        }
        if (e.key === 'Enter' && e.shiftKey && !k.isComposing) {
          e.preventDefault();
          document.execCommand('insertText', false, '\n');
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey && !k.isComposing) {
          e.preventDefault();
          const hasDraft = Boolean(k.valueRef.current.trim() || k.attachmentsLen > 0);
          if (k.runBusy) {
            if ((e.metaKey || e.ctrlKey) && hasDraft) {
              k.interruptDraft?.();
              return;
            }
            if (!e.metaKey && !e.ctrlKey && !e.altKey && hasDraft) {
              void k.flushSteeringDraft?.();
              return;
            }
            return;
          }
          if (hasDraft) k.send();
        }
      }}
    />
  );
});

export const ChatComposer = memo(function ChatComposer({
  disabled,
  sending,
  streaming,
  sessionKey,
  sessionManager,
  canSelectWorkingDirectory,
  thinkingLevel,
  showThinkingSelector,
  onThinkingChange,
  onSend,
  onAbort,
  onAddPendingFollowUp,
  onSteeringInterrupt,
  pendingFollowUps,
  onPopPendingFollowUp,
  onPendingFollowUpRemove,
  onPendingFollowUpMove,
  onPendingFollowUpReorder,
  onPendingFollowUpSteer,
  steeringFollowUpId,
  welcomeDraftSeed,
}: {
  disabled: boolean;
  sending: boolean;
  streaming: boolean;
  sessionKey: string | null;
  sessionManager: SessionManager;
  /** Fills the composer when the user picks an empty-state scenario (id must change per pick). */
  welcomeDraftSeed?: { id: number; text: string } | null;
  /** Allow choosing workspace only for a new conversation (no messages yet). */
  canSelectWorkingDirectory: boolean;
  thinkingLevel: string;
  showThinkingSelector: boolean;
  onThinkingChange: (level: string) => void;
  onSend: (
    text: string,
    attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
    thinkingLevel?: string,
  ) => void;
  onAbort: () => void;
  onAddPendingFollowUp?: (
    text: string,
    attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
  ) => void | Promise<void>;
  onSteeringInterrupt?: (
    text: string,
    attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
  ) => void;
  pendingFollowUps: PendingFollowUp[];
  onPopPendingFollowUp: (id: string) => {
    text: string;
    attachments: NonNullable<PendingFollowUp['attachments']>;
    thinkingLevel?: string;
  } | null;
  onPendingFollowUpRemove: (id: string) => void;
  onPendingFollowUpMove: (id: string, dir: 'up' | 'down') => void;
  onPendingFollowUpReorder: (fromIndex: number, toIndex: number) => void;
  onPendingFollowUpSteer: (id: string) => void;
  steeringFollowUpId: string | null;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  /** Set when unmounting so `MediaRecorder` `onstop` does not auto-send. */
  const voiceSkipAutoSendRef = useRef(false);
  const valueRef = useRef(value);
  const attachmentsRef = useRef(attachments);
  const thinkingLevelRef = useRef(thinkingLevel);
  const busyRef = useRef(false);
  const onSendRef = useRef(onSend);
  const lastWelcomeDraftIdRef = useRef(0);

  const runBusy = sending || streaming;

  /** Focus input when the composer becomes interactive (enter chat / session finished loading). */
  const pendingFocusAfterEnableRef = useRef(true);

  const atRangeForSuppress = useMemo(() => detectAtRange(value, cursor), [value, cursor]);
  const slashRangeRaw = useMemo(() => detectSlashRange(value, cursor), [value, cursor]);
  const suppressSlash = Boolean(atRangeForSuppress && !slashRangeRaw);
  const palette = useCommandPalette(value, cursor, { suppress: suppressSlash });
  const atPicker = useAtMentionPicker(value, cursor, {
    sessionKey,
    slashPaletteOpen: palette.open,
  });

  valueRef.current = value;
  attachmentsRef.current = attachments;
  thinkingLevelRef.current = thinkingLevel;
  busyRef.current = runBusy;
  onSendRef.current = onSend;

  const adjustHeight = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    if (!welcomeDraftSeed || welcomeDraftSeed.id === lastWelcomeDraftIdRef.current) return;
    lastWelcomeDraftIdRef.current = welcomeDraftSeed.id;
    const nextText = welcomeDraftSeed.text;
    setValue(nextText);
    valueRef.current = nextText;
    setAttachments([]);
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (el) {
        applyWireToEditor(el, nextText, nextText.length);
        syncComposerPlaceholderClass(el, nextText);
        el.focus({ preventScroll: true });
      }
      adjustHeight();
    });
  }, [welcomeDraftSeed, adjustHeight]);

  useLayoutEffect(() => {
    if (disabled) {
      pendingFocusAfterEnableRef.current = true;
      return;
    }
    if (!pendingFocusAfterEnableRef.current) return;
    pendingFocusAfterEnableRef.current = false;
    const id = requestAnimationFrame(() => {
      editorRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [disabled]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const onSelectionChange = () => {
      if (document.activeElement !== el) return;
      setCursor(getWireCaretOffset(el));
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const remaining = MAX_CHAT_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        console.warn(interpolate(m.chat.maxAttachmentsReached, { max: MAX_CHAT_ATTACHMENTS }));
        return;
      }
      const slice = files.slice(0, remaining);
      if (files.length > slice.length) {
        console.warn(
          interpolate(m.chat.maxAttachmentsTruncated, { max: MAX_CHAT_ATTACHMENTS, dropped: files.length - slice.length }),
        );
      }
      const { loadAttachment } = await import('@/features/chat/attachment-load');
      const next: Attachment[] = [];
      for (const file of slice) {
        if (file.size > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES) {
          console.warn(
            interpolate(m.chat.attachmentFileTooLarge, {
              name: file.name,
              maxSize: formatFileSize(MAX_WEBCHAT_ATTACHMENT_FILE_BYTES),
            }),
          );
          continue;
        }
        try {
          next.push(await loadAttachment(file, file.name));
        } catch (err) {
          console.warn(`Failed to load attachment ${file.name}:`, err);
        }
      }
      setAttachments((a) => [...a, ...next]);
    },
    [attachments.length, m.chat.attachmentFileTooLarge, m.chat.maxAttachmentsReached, m.chat.maxAttachmentsTruncated],
  );

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

  const attachmentToWire = useCallback((a: Attachment) => {
    return {
      type: a.type === 'voice' ? 'voice' : a.type || 'file',
      mimeType: a.mimeType,
      data: a.content,
      name: a.name,
      size: a.size,
    };
  }, []);

  const toggleVoiceRecording = useCallback(async () => {
    if (runBusy || disabled) return;
    if (voiceRecording) {
      stopVoiceRecording();
      return;
    }
    if (attachments.length >= MAX_CHAT_ATTACHMENTS) {
      console.warn(interpolate(m.chat.maxAttachmentsReached, { max: MAX_CHAT_ATTACHMENTS }));
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
      rec.onstop = async () => {
        try {
          if (voiceSkipAutoSendRef.current) {
            voiceSkipAutoSendRef.current = false;
            return;
          }
          if (busyRef.current) return;
          const chunks = mediaChunksRef.current;
          mediaChunksRef.current = [];
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          if (blob.size < 32) return;
          const ext = blob.type.includes('webm') ? 'webm' : 'ogg';
          const { loadAttachment } = await import('@/features/chat/attachment-load');
          const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type });
          const att = await loadAttachment(file, file.name);
          const payload = [...attachmentsRef.current.map(attachmentToWire), attachmentToWire(att)];
          onSendRef.current(valueRef.current, payload, thinkingLevelRef.current);
          setValue('');
          valueRef.current = '';
          setAttachments([]);
          requestAnimationFrame(() => {
            const ed = editorRef.current;
            if (ed) {
              applyWireToEditor(ed, '');
              syncComposerPlaceholderClass(ed, '');
            }
            adjustHeight();
          });
        } finally {
          stopVoiceMediaStreamTracks();
        }
      };
      mediaRecorderRef.current = rec;
      rec.start(250);
      setVoiceRecording(true);
    } catch (e) {
      stopVoiceMediaStreamTracks();
      mediaRecorderRef.current = null;
      console.warn(m.chat.voiceMicDenied, e);
    }
  }, [
    attachmentToWire,
    attachments.length,
    runBusy,
    disabled,
    m.chat.maxAttachmentsReached,
    m.chat.voiceMicDenied,
    stopVoiceMediaStreamTracks,
    stopVoiceRecording,
    voiceRecording,
    adjustHeight,
  ]);

  useEffect(() => {
    return () => {
      voiceSkipAutoSendRef.current = true;
      stopVoiceRecording();
    };
  }, [stopVoiceRecording]);

  const replaceRange = (text: string, start: number, end: number, insert: string) =>
    text.slice(0, start) + insert + text.slice(end);

  const applyPaletteItem = (item: PaletteItem) => {
    const range = palette.slashRange;
    if (!range) return;
    if (item.kind === 'command' && range.start === 0 && busyRef.current) {
      return;
    }

    if (item.kind === 'skill') {
      const insert = `/skill:${item.name}`;
      const next = replaceRange(valueRef.current, range.start, range.end, insert);
      setValue(next);
      valueRef.current = next;
      const pos = range.start + insert.length;
      requestAnimationFrame(() => {
        const el = editorRef.current;
        if (el) {
          applyWireToEditor(el, next, pos);
          syncComposerPlaceholderClass(el, next);
          setCursor(pos);
          el.focus();
        }
        adjustHeight();
      });
      return;
    }

    // Slash commands are only valid at the start of the composer (`/new`); mid-string `/` is for skills.
    if (item.kind === 'command' && range.start !== 0) {
      return;
    }

    const accepts = item.acceptsArgs === true;
    if (!accepts) {
      onSend(`/${item.name}`, undefined, thinkingLevel);
      setValue('');
      valueRef.current = '';
      setAttachments([]);
      requestAnimationFrame(() => {
        const el = editorRef.current;
        if (el) {
          applyWireToEditor(el, '');
          syncComposerPlaceholderClass(el, '');
        }
        adjustHeight();
      });
      return;
    }

    const insert = `/${item.name} `;
    const next = replaceRange(valueRef.current, range.start, range.end, insert);
    setValue(next);
    valueRef.current = next;
    const pos = range.start + insert.length;
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (el) {
        applyWireToEditor(el, next, pos);
        syncComposerPlaceholderClass(el, next);
        setCursor(pos);
        el.focus();
      }
      adjustHeight();
    });
  };

  const applyAtMentionItem = (item: AtMentionItem) => {
    const range = atPicker.atRange;
    if (!range) return;
    const path =
      item.isDirectory && !item.relativePath.endsWith('/') ? `${item.relativePath}/` : item.relativePath;
    const insert = `@file:${path}`;
    const next = replaceRange(valueRef.current, range.start, range.end, insert);
    setValue(next);
    valueRef.current = next;
    const pos = range.start + insert.length;
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (el) {
        applyWireToEditor(el, next, pos);
        syncComposerPlaceholderClass(el, next);
        setCursor(pos);
        el.focus();
      }
      adjustHeight();
    });
  };

  const wireAttachmentsPayload = () =>
    attachments.map((a) => ({
      type: a.type === 'voice' ? 'voice' : a.type || 'file',
      mimeType: a.mimeType,
      data: a.content,
      name: a.name,
      size: a.size,
    }));

  const clearComposer = () => {
    setValue('');
    valueRef.current = '';
    setAttachments([]);
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (el) {
        applyWireToEditor(el, '');
        syncComposerPlaceholderClass(el, '');
      }
      adjustHeight();
    });
  };

  const hydrateFollowUpIntoComposer = useCallback(
    (id: string) => {
      const popped = onPopPendingFollowUp(id);
      if (!popped) return;
      if (popped.thinkingLevel != null && showThinkingSelector) {
        onThinkingChange(popped.thinkingLevel);
      }
      const nextText = popped.text;
      setValue(nextText);
      valueRef.current = nextText;
      setAttachments(wireFollowUpAttachmentsToComposer(popped.attachments));
      requestAnimationFrame(() => {
        const el = editorRef.current;
        if (el) {
          applyWireToEditor(el, nextText, nextText.length);
          syncComposerPlaceholderClass(el, nextText);
          el.focus({ preventScroll: true });
        }
        adjustHeight();
      });
    },
    [adjustHeight, onPopPendingFollowUp, onThinkingChange, showThinkingSelector],
  );

  const flushSteeringDraft = useCallback(async () => {
    if (!runBusy || !onAddPendingFollowUp) return;
    if (voiceRecording) {
      stopVoiceRecording();
      return;
    }
    if (!value.trim() && attachments.length === 0) return;
    if (pendingFollowUps.length >= MAX_PENDING_FOLLOW_UPS) {
      console.warn(interpolate(m.chat.followUpQueueMaxReached, { max: MAX_PENDING_FOLLOW_UPS }));
      return;
    }
    const payload = wireAttachmentsPayload();
    await onAddPendingFollowUp(value, payload.length ? payload : undefined);
    clearComposer();
  }, [
    attachments,
    m.chat.followUpQueueMaxReached,
    onAddPendingFollowUp,
    pendingFollowUps.length,
    runBusy,
    stopVoiceRecording,
    value,
    voiceRecording,
  ]);

  const interruptDraft = useCallback(() => {
    if (!runBusy || !onSteeringInterrupt) return;
    if (voiceRecording) {
      stopVoiceRecording();
      return;
    }
    if (!value.trim() && attachments.length === 0) return;
    const payload = wireAttachmentsPayload();
    onSteeringInterrupt(value, payload.length ? payload : undefined);
    clearComposer();
  }, [attachments, onSteeringInterrupt, runBusy, stopVoiceRecording, value, voiceRecording]);

  const send = () => {
    if (runBusy) return;
    if (voiceRecording) {
      stopVoiceRecording();
      return;
    }
    if (!value.trim() && attachments.length === 0) return;
    const payload = wireAttachmentsPayload();
    onSend(value, payload.length ? payload : undefined, thinkingLevel);
    clearComposer();
  };

  const onWireInput = useCallback((wire: string, caret: number) => {
    valueRef.current = wire;
    setValue(wire);
    setCursor(caret);
  }, []);

  const kbdRef = useRef({} as ComposerKbdContext);

  const ThinkingIcon = thinkingIcon(thinkingLevel as ThinkingLevel);

  kbdRef.current = {
    palette,
    atPicker,
    replaceRange,
    applyPaletteItem,
    applyAtMentionItem,
    send,
    runBusy,
    flushSteeringDraft,
    interruptDraft,
    attachmentsLen: attachments.length,
    isComposing,
    valueRef,
    setValue,
    setCursor,
    adjustHeight,
    editorRef,
  };

  return (
    <div
      className={cn(
        'relative flex min-h-0 w-full flex-col overflow-hidden rounded-xl bg-surface-panel shadow-surface ring-1 ring-inset ring-edge dark:bg-surface-panel/60 dark:shadow-none',
        isDragging && 'ring-2 ring-accent ring-inset',
      )}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes('Files')) {
            e.preventDefault();
            setIsDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.relatedTarget === null) setIsDragging(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDragging(false);
          const files = e.dataTransfer?.files;
          if (files?.length) await processFiles(Array.from(files));
        }}
      >
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b border-edge-subtle/90 bg-surface-hover/20 px-4 pb-2 pt-3 dark:border-edge-subtle">
            {attachments.map((att, index) => (
              <div
                key={`${att.name}-${index}`}
                className="flex max-w-[200px] items-center gap-1.5 rounded-lg bg-surface-hover px-2 py-1 text-xs dark:bg-surface-hover/80"
              >
                {att.mimeType?.startsWith('image/') && att.content ? (
                  <img
                    src={`data:${att.mimeType};base64,${att.content}`}
                    alt=""
                    className="h-6 w-6 rounded object-cover"
                  />
                ) : att.type === 'voice' || att.mimeType?.startsWith('audio/') ? (
                  <Mic className="h-3.5 w-3.5 shrink-0 text-accent-fg" aria-hidden />
                ) : (
                  <FileIcon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                )}
                <span className="min-w-0 flex-1 truncate">{att.name}</span>
                <span className="text-fg-disabled">{formatFileSize(att.size)}</span>
                <button
                  type="button"
                  className="text-fg-muted hover:text-fg"
                  onClick={() => setAttachments((a) => a.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-accent-soft/80 text-sm font-medium text-accent-fg backdrop-blur-[1px]">
            {m.chat.dropFiles}
          </div>
        ) : null}

        {runBusy && pendingFollowUps.length > 0 ? (
          <div className="max-h-[min(30vh,11rem)] shrink-0 overflow-y-auto overflow-x-hidden border-b border-edge-subtle/80 [scrollbar-gutter:stable] dark:border-edge-subtle/70">
            <ChatPendingFollowUpStack
              items={pendingFollowUps}
              disabled={disabled}
              onEditInComposer={hydrateFollowUpIntoComposer}
              onRemove={onPendingFollowUpRemove}
              onMove={onPendingFollowUpMove}
              onReorder={onPendingFollowUpReorder}
              onSteer={onPendingFollowUpSteer}
              steeringBusyId={steeringFollowUpId}
            />
          </div>
        ) : null}

        <div className="flex min-h-0 shrink-0 flex-col">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={async (e) => {
            const files = e.target.files;
            if (files) await processFiles(Array.from(files));
            e.target.value = '';
          }}
        />

        <div
          className={cn(
            'relative px-4 pb-0 pt-1',
            attachments.length > 0 && 'pt-2',
          )}
        >
            <AtMentionPicker
              open={atPicker.open}
              anchorRef={editorRef}
              items={atPicker.items}
              selectedIndex={atPicker.selectedIndex}
              loading={atPicker.loading}
              query={atPicker.query}
              noResults={atPicker.error ?? m.chat.atMention.noResults}
              onSelectItem={applyAtMentionItem}
            />
            <CommandPalette
              open={palette.open}
              anchorRef={editorRef}
              items={palette.loadError ? [] : palette.items}
              selectedIndex={palette.selectedIndex}
              noResults={palette.loadError ?? m.chat.commandPalette.noResults}
              onSelectItem={applyPaletteItem}
            />
            <ChatComposerInput
              editorRef={editorRef}
              disabled={disabled}
              placeholder={runBusy ? m.chat.inputPlaceholderSteering : m.chat.inputPlaceholder}
              onWireInput={onWireInput}
              adjustHeight={adjustHeight}
              processFiles={processFiles}
              setIsComposing={setIsComposing}
              kbdRef={kbdRef}
            />
        </div>

        <div
          className={cn(
            'flex flex-wrap items-center gap-2 border-t border-edge-subtle/90 px-4 py-2.5 dark:border-edge-subtle',
          )}
        >
            <SessionWorkingDirectoryControl
              sessionKey={sessionKey}
              sessionMgr={sessionManager}
              canSelectWorkingDirectory={canSelectWorkingDirectory}
              disabled={disabled || runBusy}
            />
            <button
              type="button"
              className={cn(
                'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover/70 text-fg-subtle hover:bg-surface-hover hover:text-fg dark:bg-surface-hover/50',
                interaction.transition,
                interaction.press,
                interaction.focusRingPanel,
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              disabled={attachments.length >= MAX_CHAT_ATTACHMENTS || disabled || runBusy}
              title={
                attachments.length >= MAX_CHAT_ATTACHMENTS
                  ? interpolate(m.chat.maxAttachmentsReached, { max: MAX_CHAT_ATTACHMENTS })
                  : `${m.chat.attachFile} (${attachments.length}/${MAX_CHAT_ATTACHMENTS})`
              }
              onClick={() => fileInputRef.current?.click()}
            >
              <FileIcon className="h-4 w-4" />
            </button>

            {showThinkingSelector ? (
              <div
                className="inline-flex min-h-8 items-center gap-1 rounded-full bg-surface-hover px-2.5 py-1 text-xs dark:bg-surface-hover/80"
                title={`${m.chat.thinkingLevel}: ${thinkingLevel}`}
              >
                <ThinkingIcon className="h-3.5 w-3.5 shrink-0 text-accent-fg" aria-hidden />
                <select
                  className="max-w-[min(6.5rem,30vw)] cursor-pointer appearance-none bg-transparent pl-0 pr-0 text-[0.8125rem] font-medium text-fg focus:outline-none"
                  value={thinkingLevel}
                  disabled={disabled || (sending && !streaming)}
                  onChange={(e) => onThinkingChange(e.target.value)}
                >
                  {(Object.keys(m.chat.thinkingLevels) as ThinkingLevel[]).map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {m.chat.thinkingLevels[lvl]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className={cn(
                  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent',
                  interaction.transition,
                  interaction.press,
                  interaction.focusRingPanel,
                  voiceRecording
                    ? 'bg-red-500/20 text-red-600 dark:bg-red-500/25 dark:text-red-400'
                    : 'text-fg-subtle hover:bg-surface-hover hover:text-fg',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
                disabled={disabled || runBusy || attachments.length >= MAX_CHAT_ATTACHMENTS}
                title={voiceRecording ? m.chat.voiceRecordingStop : m.chat.voiceRecording}
                aria-label={voiceRecording ? m.chat.voiceRecordingStop : m.chat.voiceRecording}
                onClick={() => void toggleVoiceRecording()}
              >
                <Mic className={cn('h-4 w-4 stroke-[1.75]', voiceRecording && 'animate-pulse')} />
              </button>

              {runBusy ? (
                <>
                  {(value.trim() || attachments.length > 0) && onSteeringInterrupt ? (
                    <button
                      type="button"
                      className={cn(
                        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-accent-fg hover:bg-accent-soft dark:hover:bg-accent-soft',
                        interaction.transition,
                        interaction.press,
                        interaction.focusRingPanel,
                      )}
                      title={m.chat.steeringInterruptSend}
                      aria-label={m.chat.steeringInterruptSend}
                      onClick={() => void interruptDraft()}
                    >
                      <Send className="h-4 w-4 stroke-[1.75]" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={cn(
                      'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover/70 text-fg-muted hover:bg-surface-hover hover:text-fg dark:bg-surface-hover/50',
                      interaction.transition,
                      interaction.press,
                      interaction.focusRingPanel,
                    )}
                    title={m.chat.abort}
                    aria-label={m.chat.abort}
                    onClick={onAbort}
                  >
                    <Square className="h-4 w-4 stroke-[1.75]" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={cn(
                    'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 ease-out',
                    interaction.press,
                    interaction.focusRingPanel,
                    value.trim() || attachments.length > 0
                      ? 'border-transparent text-accent-fg hover:bg-accent-soft dark:text-accent-fg dark:hover:bg-accent-soft'
                      : 'border-transparent text-fg-disabled',
                  )}
                  disabled={disabled || (!value.trim() && attachments.length === 0)}
                  title={m.chat.sendMessage}
                  aria-label={m.chat.sendMessage}
                  onClick={send}
                >
                  <Send className="h-4 w-4 stroke-[1.75]" />
                </button>
              )}
            </div>
        </div>
        </div>
    </div>
  );
});
