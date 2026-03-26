import { Ban, File, Mic, Send, Sparkles, Square } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import type { Attachment } from '@/features/chat/attachment-utils';
import { ComposerRunStatus } from '@/features/chat/composer-run-status';
import { formatFileSize, MAX_CHAT_ATTACHMENTS } from '@/features/chat/attachment-utils';
import { ModelSelector } from '@/features/chat/model-selector';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

const ACCEPT =
  'image/*,application/pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml,.zip';

/** Matches ui `03-chat-editor.css` `.text-input`: max-height 8rem, line-height 1.55. */
const TEXTAREA_MAX_HEIGHT_PX = 128;

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive';

function thinkingIcon(level: ThinkingLevel) {
  return level === 'off' ? Ban : Sparkles;
}

export const ChatComposer = memo(function ChatComposer({
  disabled,
  sending,
  streaming,
  sessionModel,
  showModelSelector,
  onModelChange,
  thinkingLevel,
  showThinkingSelector,
  onThinkingChange,
  onSend,
  onAbort,
}: {
  disabled: boolean;
  sending: boolean;
  streaming: boolean;
  sessionModel: string;
  /** Show model picker when a session is active and route matches loaded session. */
  showModelSelector: boolean;
  onModelChange: (modelId: string) => void;
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
    // Reset before measuring — `height: auto` often leaves an inflated scrollHeight in WebKit/Blink.
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX);
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
    const { loadAttachment } = await import('@/features/chat/attachment-load');
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

  // Outer column (px + max-w-app-main) lives in chat-page — matches the message list column.
  return (
    <div
      className={cn(
        // ring (not border) so inner text width matches the main column; border costs 2px in border-box.
        'relative w-full overflow-hidden rounded-xl bg-surface-panel shadow-surface ring-1 ring-inset ring-edge dark:bg-surface-panel/60 dark:ring-edge dark:shadow-none',
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
          <div className="flex flex-wrap gap-2 border-b border-edge-subtle px-4 pb-2 pt-3 dark:border-edge/80">
            {attachments.map((att, index) => (
              <div
                key={`${att.name}-${index}`}
                className="flex max-w-[200px] items-center gap-1.5 rounded-lg border border-edge bg-surface-hover px-2 py-1 text-xs dark:border-edge-strong"
              >
                {att.mimeType?.startsWith('image/') && att.content ? (
                  <img
                    src={`data:${att.mimeType};base64,${att.content}`}
                    alt=""
                    className="h-6 w-6 rounded object-cover"
                  />
                ) : (
                  <File className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
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

        {busy ? <ComposerRunStatus sending={sending} streaming={streaming} /> : null}

        <div
          className={cn(
            'px-4 pb-2 pt-3',
            attachments.length > 0 && 'pt-2',
          )}
        >
          <textarea
            ref={textareaRef}
            className="max-h-32 min-h-[1.5rem] w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-[0.9375rem] leading-[1.55] text-fg placeholder:text-fg-disabled focus:outline-none focus:ring-0 disabled:opacity-50"
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
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-edge-subtle px-4 pb-2.5 pt-2 dark:border-edge/80">
          {showModelSelector ? (
            <div className="min-w-0 max-w-[min(14rem,calc(100vw-10rem))] shrink">
              <ModelSelector
                value={sessionModel}
                disabled={disabled || streaming}
                placeholder={m.chat.modelPlaceholder}
                searchPlaceholder={m.chat.modelSearchPlaceholder}
                noMatches={m.chat.modelNoMatches}
                compact
                showProviderInTrigger={false}
                contentSide="top"
                contentAlign="start"
                onChange={onModelChange}
              />
            </div>
          ) : null}
          {showThinkingSelector ? (
            <div
              className="inline-flex min-h-8 items-center gap-1 rounded-full border border-edge bg-surface-hover px-2.5 py-1 text-xs dark:border-edge-strong dark:bg-surface-hover/80"
              title={`${m.chat.thinkingLevel}: ${thinkingLevel}`}
            >
              <ThinkingIcon className="h-3.5 w-3.5 shrink-0 text-accent-fg" aria-hidden />
              <select
                className="max-w-[min(6.5rem,30vw)] cursor-pointer appearance-none bg-transparent pl-0 pr-0 text-[0.8125rem] font-medium text-fg focus:outline-none"
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
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-panel text-fg-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-fg disabled:opacity-50 dark:border-edge-strong"
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
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent bg-transparent text-fg-disabled opacity-80"
              disabled
              title={m.chat.voiceComingSoon}
            >
              <Mic className="h-4 w-4 stroke-[1.75]" />
            </button>

            {busy ? (
              <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-panel text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg dark:border-edge-strong"
                title={m.chat.abort}
                onClick={onAbort}
              >
                <Square className="h-4 w-4 stroke-[1.75]" />
              </button>
            ) : (
              <button
                type="button"
                className={cn(
                  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 active:scale-95',
                  value.trim() || attachments.length > 0
                    ? 'border-transparent text-accent-fg hover:bg-accent-soft dark:text-accent-fg dark:hover:bg-accent-soft'
                    : 'border-transparent text-fg-disabled',
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
  );
});
