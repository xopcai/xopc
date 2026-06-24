import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, Eye, RefreshCw, Sparkles, SquarePen, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import type { TextAssistFormat, TextAssistIntent, TextAssistScenario } from './ai-text-assist-api';
import { useAiTextAssist } from './use-ai-text-assist';

type AiTextAssistLabels = {
  title: string;
  buttonTitle: string;
  current: string;
  suggestion: string;
  editedSuggestion: string;
  thinking: string;
  thinkingLoading: string;
  edit: string;
  preview: string;
  loading: string;
  empty: string;
  regenerate: string;
  applyCurrent: string;
  replace: string;
  append: string;
  cancel: string;
  close: string;
};

type AssistPaneMode = 'edit' | 'preview';

const THINKING_AUTO_SCROLL_THRESHOLD_PX = 5;

function labelsForLocale(locale: string): AiTextAssistLabels {
  if (locale.startsWith('zh')) {
    return {
      title: 'AI 优化文案',
      buttonTitle: '优化文案',
      current: '当前内容',
      suggestion: 'AI 建议',
      editedSuggestion: '审核并编辑建议',
      thinking: '模型思考',
      thinkingLoading: '思考中',
      edit: '编辑',
      preview: '预览',
      loading: '正在生成建议...',
      empty: '暂无内容',
      regenerate: '重新生成',
      applyCurrent: '应用当前内容',
      replace: '替换',
      append: '追加',
      cancel: '取消',
      close: '关闭',
    };
  }
  return {
    title: 'AI text assist',
    buttonTitle: 'Improve text',
    current: 'Current',
    suggestion: 'Suggestion',
    editedSuggestion: 'Review and edit suggestion',
    thinking: 'Model thinking',
    thinkingLoading: 'Thinking',
    edit: 'Edit',
    preview: 'Preview',
    loading: 'Generating suggestion...',
    empty: 'No content',
    regenerate: 'Regenerate',
    applyCurrent: 'Apply current',
    replace: 'Replace',
    append: 'Append',
    cancel: 'Cancel',
    close: 'Close',
  };
}

export function AiTextAssistButton({
  value,
  onApply,
  fieldId,
  fieldLabel,
  scenario = 'generic.text',
  format = 'plain',
  intent = 'improve',
  locale,
  context,
  disabled,
  className,
  showLabel = true,
}: {
  value: string;
  onApply: (value: string) => void;
  fieldId: string;
  fieldLabel?: string;
  scenario?: TextAssistScenario;
  format?: TextAssistFormat;
  intent?: TextAssistIntent;
  locale: string;
  context?: Record<string, unknown>;
  disabled?: boolean;
  className?: string;
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [currentDraft, setCurrentDraft] = useState(value);
  const [currentMode, setCurrentMode] = useState<AssistPaneMode>('preview');
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<AssistPaneMode>('edit');
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const thinkingScrollRef = useRef<HTMLPreElement | null>(null);
  const shouldFollowThinkingRef = useRef(true);
  const { suggestion, thinking, loading, error, generate, reset } = useAiTextAssist();
  const labels = useMemo(() => labelsForLocale(locale), [locale]);
  const showThinking = loading && thinking.trim().length > 0;

  useEffect(() => {
    if (!open) {
      setCurrentDraft(value);
    }
  }, [open, value]);

  useEffect(() => {
    setDraft(suggestion);
  }, [suggestion]);

  useEffect(() => {
    if (thinking.trim()) {
      setThinkingOpen(true);
    }
  }, [thinking]);

  useLayoutEffect(() => {
    const el = thinkingScrollRef.current;
    if (!el || !showThinking || !thinkingOpen) return;
    if (shouldFollowThinkingRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [showThinking, thinking, thinkingOpen]);

  const handleThinkingScroll = useCallback(() => {
    const el = thinkingScrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldFollowThinkingRef.current = distanceToBottom <= THINKING_AUTO_SCROLL_THRESHOLD_PX;
  }, []);

  const generateSuggestion = useCallback(async (input: string) => {
    setMode('edit');
    setThinkingOpen(true);
    shouldFollowThinkingRef.current = true;
    await generate({
      intent,
      scenario,
      input,
      locale,
      field: {
        id: fieldId,
        label: fieldLabel,
        format,
      },
      context,
    });
  }, [context, fieldId, fieldLabel, format, generate, intent, locale, scenario]);

  const requestSuggestion = useCallback(async () => {
    setCurrentDraft(value);
    setCurrentMode('preview');
    setOpen(true);
    await generateSuggestion(value);
  }, [generateSuggestion, value]);

  const regenerateSuggestion = useCallback(async () => {
    await generateSuggestion(currentDraft);
  }, [currentDraft, generateSuggestion]);

  const close = useCallback(() => {
    setOpen(false);
    setCurrentDraft(value);
    setCurrentMode('preview');
    setDraft('');
    setMode('edit');
    setThinkingOpen(true);
    reset();
  }, [reset, value]);

  const applyCurrent = useCallback(() => {
    onApply(currentDraft);
    close();
  }, [close, currentDraft, onApply]);

  const applyReplacement = useCallback(() => {
    const nextValue = draft.trim();
    if (!nextValue) return;
    onApply(draft);
    close();
  }, [close, draft, onApply]);

  const appendSuggestion = useCallback(() => {
    const nextValue = draft.trim();
    if (!nextValue) return;
    const prefix = currentDraft.trimEnd();
    onApply(prefix ? `${prefix}\n\n${draft}` : draft);
    close();
  }, [close, currentDraft, draft, onApply]);

  const canApply = !loading && !error && draft.trim().length > 0;
  const currentChanged = currentDraft !== value;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className={cn('h-7 gap-1 px-2 text-xs', !showLabel && 'size-7 p-0', className)}
        title={labels.buttonTitle}
        aria-label={labels.buttonTitle}
        disabled={disabled || loading}
        onClick={() => void requestSuggestion()}
      >
        <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden />
        {showLabel ? labels.buttonTitle : null}
      </Button>

      <Dialog.Root open={open} onOpenChange={(next) => (!next ? close() : setOpen(true))}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim" />
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 pointer-events-none">
            <Dialog.Content
              className="xopc-dialog-content-pane pointer-events-auto flex h-[min(78vh,38rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3">
                <Dialog.Title className="text-base font-semibold text-fg">{labels.title}</Dialog.Title>
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={labels.close}>
                    <X className="size-5" strokeWidth={1.75} />
                  </Button>
                </Dialog.Close>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-4 md:grid-cols-2">
                <div className="flex min-h-0 flex-col overflow-hidden">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 text-xs font-medium text-fg-muted">{labels.current}</div>
                    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-edge bg-surface-muted p-0.5">
                      <button
                        type="button"
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium',
                          currentMode === 'edit'
                            ? 'bg-surface-panel text-fg shadow-surface'
                            : 'text-fg-muted hover:bg-surface-hover',
                        )}
                        onClick={() => setCurrentMode('edit')}
                      >
                        <SquarePen className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                        {labels.edit}
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium',
                          currentMode === 'preview'
                            ? 'bg-surface-panel text-fg shadow-surface'
                            : 'text-fg-muted hover:bg-surface-hover',
                        )}
                        onClick={() => setCurrentMode('preview')}
                      >
                        <Eye className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                        {labels.preview}
                      </button>
                    </div>
                  </div>
                  {currentMode === 'preview' ? (
                    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-edge bg-surface-base p-3 text-sm leading-6 text-fg">
                      {format === 'markdown' ? (
                        <MarkdownView content={currentDraft || labels.empty} compact className="text-sm" />
                      ) : (
                        <pre className="whitespace-pre-wrap text-sm leading-6 text-fg">{currentDraft || labels.empty}</pre>
                      )}
                    </div>
                  ) : (
                    <textarea
                      className="min-h-0 flex-1 resize-none overflow-auto rounded-lg border border-edge bg-surface-base p-3 text-sm leading-6 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                      value={currentDraft}
                      onChange={(event) => setCurrentDraft(event.currentTarget.value)}
                      placeholder={labels.empty}
                      aria-label={labels.current}
                    />
                  )}
                </div>
                <div className="flex min-h-0 flex-col overflow-hidden">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 text-xs font-medium text-fg-muted">
                      <span>{labels.editedSuggestion}</span>
                      {loading ? <span className="ml-2 font-normal">{labels.loading}</span> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-edge bg-surface-muted p-0.5">
                      <button
                        type="button"
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium',
                          mode === 'edit'
                            ? 'bg-surface-panel text-fg shadow-surface'
                            : 'text-fg-muted hover:bg-surface-hover',
                        )}
                        onClick={() => setMode('edit')}
                      >
                        <SquarePen className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                        {labels.edit}
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium',
                          mode === 'preview'
                            ? 'bg-surface-panel text-fg shadow-surface'
                            : 'text-fg-muted hover:bg-surface-hover',
                        )}
                        onClick={() => setMode('preview')}
                      >
                        <Eye className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                        {labels.preview}
                      </button>
                    </div>
                  </div>
                  <div className="relative min-h-0 flex-1 overflow-hidden">
                    <div
                      className={cn(
                        'absolute inset-0 min-h-0 transition-opacity duration-200 ease-out motion-reduce:transition-none',
                        showThinking ? 'opacity-100' : 'pointer-events-none opacity-0',
                      )}
                      aria-hidden={!showThinking}
                    >
                      <div className="flex h-full min-h-0 flex-col rounded-lg border border-edge bg-surface-muted/70">
                        <button
                          type="button"
                          className="flex shrink-0 items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-medium text-fg-muted hover:text-fg"
                          onClick={() => setThinkingOpen((current) => !current)}
                        >
                          <span className="min-w-0 truncate">
                            {labels.thinking}
                            {loading ? <span className="ml-1 font-normal">· {labels.thinkingLoading}</span> : null}
                          </span>
                          <ChevronDown
                            className={cn('size-3.5 shrink-0 transition-transform', thinkingOpen && 'rotate-180')}
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        </button>
                        {thinkingOpen ? (
                          <pre
                            ref={thinkingScrollRef}
                            className="min-h-0 flex-1 overflow-auto border-t border-edge px-2.5 py-2 whitespace-pre-wrap text-xs leading-5 text-fg-muted"
                            onScroll={handleThinkingScroll}
                          >
                            {thinking}
                          </pre>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className={cn(
                        'absolute inset-0 min-h-0 transition-opacity duration-200 ease-out motion-reduce:transition-none',
                        showThinking ? 'pointer-events-none opacity-0' : 'opacity-100',
                      )}
                    >
                      {error ? (
                        <pre className="h-full min-h-0 overflow-auto whitespace-pre-wrap rounded-lg border border-edge bg-surface-base p-3 text-sm leading-6 text-fg-muted">
                          {error}
                        </pre>
                      ) : mode === 'preview' ? (
                        <div className="h-full min-h-0 overflow-auto rounded-lg border border-edge bg-surface-base p-3 text-sm leading-6 text-fg">
                          {loading && !draft.trim() ? (
                            <p className="text-sm text-fg-muted">{labels.loading}</p>
                          ) : format === 'markdown' ? (
                            <MarkdownView content={draft || labels.empty} compact className="text-sm" />
                          ) : (
                            <pre className="whitespace-pre-wrap text-sm leading-6 text-fg">{draft || labels.empty}</pre>
                          )}
                        </div>
                      ) : (
                        <textarea
                          className="h-full min-h-0 w-full resize-none overflow-auto rounded-lg border border-edge bg-surface-base p-3 text-sm leading-6 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:text-fg-muted"
                          value={draft}
                          onChange={(event) => setDraft(event.currentTarget.value)}
                          disabled={loading}
                          placeholder={loading ? labels.loading : labels.empty}
                          aria-label={labels.suggestion}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-4 py-3">
                <Button type="button" variant="secondary" onClick={close}>
                  {labels.cancel}
                </Button>
                <Button type="button" variant="secondary" disabled={!currentChanged} onClick={applyCurrent}>
                  {labels.applyCurrent}
                </Button>
                <Button type="button" variant="secondary" disabled={loading} onClick={() => void regenerateSuggestion()}>
                  <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
                  {labels.regenerate}
                </Button>
                <Button type="button" variant="secondary" disabled={!canApply} onClick={appendSuggestion}>
                  {labels.append}
                </Button>
                <Button type="button" variant="primary" disabled={!canApply} onClick={applyReplacement}>
                  {labels.replace}
                </Button>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
