import { Ban, File, Mic, Send, Sparkles, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Attachment } from '@/features/chat/attachment-utils';
import {
  formatFileSize,
  loadAttachment,
  MAX_CHAT_ATTACHMENTS,
} from '@/features/chat/attachment-utils';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

const ACCEPT =
  'image/*,application/pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml,.zip';

/** Matches `leading-5` + `py-1`; `adjustHeight` caps growth. */
const TEXTAREA_LINE_PX = 20;
const TEXTAREA_MAX_LINES = 8;
/** Total vertical padding from `py-1` (4px × 2). */
const TEXTAREA_V_PAD_PX = 8;

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive';

function thinkingIcon(level: ThinkingLevel) {
  return level === 'off' ? Ban : Sparkles;
}

export function ChatComposer({
  disabled,
  sending,
  streaming,
  thinkingLevel,
  showThinkingSelector,
  onThinkingChange,
  onSend,
  onAbort,
}: {
  disabled: boolean;
  sending: boolean;
  streaming: boolean;
  thinkingLevel: string;
  showThinkingSelector: boolean;
  onThinkingChange: (level: string) => void;
  onSend: (
    text: string,
    attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
    thinkingLevel?: string,
  ) => void;
  onAbort: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxFileSize = 20 * 1024 * 1024;

  const busy = sending || streaming;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const maxHeight = TEXTAREA_LINE_PX * TEXTAREA_MAX_LINES + TEXTAREA_V_PAD_PX;
    // Reset before measuring — `height: auto` often leaves an inflated scrollHeight in WebKit/Blink.
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const processFiles = async (files: File[]) => {
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
    const next: Attachment[] = [];
    for (const file of slice) {
      if (file.size > maxFileSize) {
        console.warn(`File ${file.name} exceeds max size`);
        continue;
      }
      next.push(await loadAttachment(file, file.name));
    }
    setAttachments((a) => [...a, ...next]);
  };

  const send = () => {
    if (busy) return;
    if (!value.trim() && attachments.length === 0) return;
    const payload = attachments.map((a) => ({
      type: a.type || 'file',
      mimeType: a.mimeType,
      data: a.content,
      name: a.name,
      size: a.size,
    }));
    onSend(value, payload.length ? payload : undefined, thinkingLevel);
    setValue('');
    setAttachments([]);
    requestAnimationFrame(() => adjustHeight());
  };

  const ThinkingIcon = thinkingIcon(thinkingLevel as ThinkingLevel);

  return (
    <div className="shrink-0 border-t border-edge-subtle bg-surface-panel px-3 pb-2 pt-1.5 sm:px-4 dark:border-edge">
      <div
        className={cn(
          'relative mx-auto max-w-4xl rounded-xl border border-edge bg-surface-panel p-1.5 shadow-sm shadow-slate-200/40 dark:border-slate-700 dark:bg-slate-900/40 dark:shadow-none',
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
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {attachments.map((att, index) => (
              <div
                key={`${att.name}-${index}`}
                className="flex max-w-[200px] items-center gap-2 rounded-lg border border-edge-subtle bg-surface-hover px-2 py-1 text-xs dark:border-slate-600"
              >
                {att.mimeType?.startsWith('image/') && att.content ? (
                  <img
                    src={`data:${att.mimeType};base64,${att.content}`}
                    alt=""
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <File className="h-4 w-4 shrink-0 text-fg-muted" />
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

        <textarea
          ref={textareaRef}
          className="max-h-[168px] min-h-[32px] w-full resize-none overflow-y-auto border-0 bg-transparent px-1.5 py-1 text-sm leading-5 text-fg placeholder:text-fg-disabled focus:outline-none focus:ring-0 disabled:opacity-50"
          placeholder={m.chat.inputPlaceholder}
          value={value}
          disabled={disabled || busy}
          rows={1}
          onChange={(e) => setValue(e.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onPaste={async (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const imageFiles: File[] = [];
            for (const item of Array.from(items)) {
              if (item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) imageFiles.push(f);
              }
            }
            if (imageFiles.length > 0) {
              e.preventDefault();
              await processFiles(imageFiles);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
              e.preventDefault();
              if (!busy && (value.trim() || attachments.length > 0)) send();
            }
          }}
        />

        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 border-t border-edge-subtle pt-2 dark:border-slate-700/80">
          {showThinkingSelector ? (
            <div
              className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-hover px-2 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800/80"
              title={`${m.chat.thinkingLevel}: ${thinkingLevel}`}
            >
              <ThinkingIcon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden />
              <select
                className="max-w-[min(10rem,40vw)] cursor-pointer bg-transparent text-xs font-medium text-fg focus:outline-none"
                value={thinkingLevel}
                disabled={disabled || busy}
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

          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              className="rounded-lg p-1.5 text-fg-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-fg disabled:opacity-50"
              disabled={attachments.length >= MAX_CHAT_ATTACHMENTS || disabled || busy}
              title={
                attachments.length >= MAX_CHAT_ATTACHMENTS
                  ? interpolate(m.chat.maxAttachmentsReached, { max: MAX_CHAT_ATTACHMENTS })
                  : `${m.chat.attachFile} (${attachments.length}/${MAX_CHAT_ATTACHMENTS})`
              }
              onClick={() => fileInputRef.current?.click()}
            >
              <File className="h-4 w-4" />
            </button>
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

            <button
              type="button"
              className="rounded-lg p-1.5 text-fg-disabled opacity-70"
              disabled
              title={m.chat.voiceComingSoon}
            >
              <Mic className="h-4 w-4 stroke-[1.75]" />
            </button>

            {busy ? (
              <button
                type="button"
                className="rounded-lg p-1.5 text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
                title={m.chat.abort}
                onClick={onAbort}
              >
                <Square className="h-4 w-4 stroke-[1.75]" />
              </button>
            ) : (
              <button
                type="button"
                className={cn(
                  'rounded-lg p-1.5 transition-colors duration-150 active:scale-95',
                  value.trim() || attachments.length > 0
                    ? 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50'
                    : 'text-fg-disabled',
                )}
                disabled={disabled || (!value.trim() && attachments.length === 0)}
                title={m.chat.sendMessage}
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
}
