import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import type { TextAssistFormat, TextAssistIntent, TextAssistScenario } from './ai-text-assist-api';
import { useAiTextAssist } from './use-ai-text-assist';

type AiTextAssistLabels = {
  title: string;
  buttonTitle: string;
  current: string;
  suggestion: string;
  loading: string;
  empty: string;
  replace: string;
  append: string;
  cancel: string;
  close: string;
};

function labelsForLocale(locale: string): AiTextAssistLabels {
  if (locale.startsWith('zh')) {
    return {
      title: 'AI 优化文案',
      buttonTitle: '优化文案',
      current: '当前内容',
      suggestion: 'AI 建议',
      loading: '正在生成建议...',
      empty: '暂无内容',
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
    loading: 'Generating suggestion...',
    empty: 'No content',
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
  const { suggestion, loading, error, generate, reset } = useAiTextAssist();
  const labels = useMemo(() => labelsForLocale(locale), [locale]);

  const requestSuggestion = useCallback(async () => {
    setOpen(true);
    await generate({
      intent,
      scenario,
      input: value,
      locale,
      field: {
        id: fieldId,
        label: fieldLabel,
        format,
      },
      context,
    });
  }, [context, fieldId, fieldLabel, format, generate, intent, locale, scenario, value]);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const applyReplacement = useCallback(() => {
    if (!suggestion.trim()) return;
    onApply(suggestion);
    close();
  }, [close, onApply, suggestion]);

  const appendSuggestion = useCallback(() => {
    if (!suggestion.trim()) return;
    const prefix = value.trimEnd();
    onApply(prefix ? `${prefix}\n\n${suggestion}` : suggestion);
    close();
  }, [close, onApply, suggestion, value]);

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
                  <div className="mb-2 text-xs font-medium text-fg-muted">{labels.current}</div>
                  <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-edge bg-surface-base p-3 text-sm leading-6 text-fg">
                    {value.trim() || labels.empty}
                  </pre>
                </div>
                <div className="flex min-h-0 flex-col overflow-hidden">
                  <div className="mb-2 text-xs font-medium text-fg-muted">{labels.suggestion}</div>
                  <pre
                    className={cn(
                      'min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-edge bg-surface-base p-3 text-sm leading-6 text-fg',
                      (loading || error) && 'text-fg-muted',
                    )}
                  >
                    {loading ? labels.loading : error ?? suggestion}
                  </pre>
                </div>
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-4 py-3">
                <Button type="button" variant="secondary" onClick={close}>
                  {labels.cancel}
                </Button>
                <Button type="button" variant="secondary" disabled={loading || !suggestion.trim()} onClick={appendSuggestion}>
                  {labels.append}
                </Button>
                <Button type="button" variant="primary" disabled={loading || !suggestion.trim()} onClick={applyReplacement}>
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
