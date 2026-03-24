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
    const lineHeight = 24;
    const maxLines = 8;
    const maxHeight = lineHeight * maxLines;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
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
    <div className="border-t border-edge bg-surface-panel dark:border-edge">
      <div
        className={cn(
          'relative mx-auto max-w-3xl px-3 py-3',
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
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att, index) => (
              <div
                key={`${att.name}-${index}`}
                className="flex max-w-[200px] items-center gap-2 rounded-lg border border-edge bg-surface-hover px-2 py-1 text-xs dark:border-edge"
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
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-accent/10 text-sm font-medium text-accent-fg">
            {m.chat.dropFiles}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          className="min-h-[88px] w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg placeholder:text-fg-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
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

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {showThinkingSelector ? (
            <div
              className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-base px-2 py-1 text-xs dark:border-edge"
              title={`${m.chat.thinkingLevel}: ${thinkingLevel}`}
            >
              <ThinkingIcon className="h-3.5 w-3.5 text-accent-fg" aria-hidden />
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

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50"
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
              className="rounded-lg p-2 text-fg-muted opacity-60"
              disabled
              title={m.chat.voiceComingSoon}
            >
              <Mic className="h-4 w-4" />
            </button>

            {busy ? (
              <button
                type="button"
                className="rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
                title={m.chat.abort}
                onClick={onAbort}
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                className={cn(
                  'rounded-lg p-2',
                  value.trim() || attachments.length > 0
                    ? 'text-accent-fg hover:bg-accent/10'
                    : 'text-fg-disabled',
                )}
                disabled={disabled || (!value.trim() && attachments.length === 0)}
                title={m.chat.sendMessage}
                onClick={send}
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
