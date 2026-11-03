import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { formatStepRoundDuration } from '@/features/chat/time/step-round-duration';
import { assistantAnswerContent } from './assistant-turn-content';
import type { Message, MessageContent } from './messages.types';

/** Only a terminal run or a settled history snapshot can close the whole process. */
export function assistantProcessState(message: Message, isStreaming: boolean) {
  const answer = assistantAnswerContent(message.content);
  const hasAnswer = answer.some(block => (block.type === 'review' && (!block.status || block.status === 'complete'))
    || (block.type === 'text' && Boolean(block.text.trim())));
  const historyAnswer = message.fromHistory && hasAnswer;
  const outcome = message.outcome ?? message.taskResultDelivery?.outcome;
  const settled = !isStreaming && message.runStatus !== 'suspended'
    && Boolean(message.runStatus || outcome || historyAnswer);
  const interrupted = message.runStatus === 'error' || message.runStatus === 'cancelled' || outcome?.status === 'failed';
  return { settled, defaultCollapsed: settled && hasAnswer && !interrupted, outcome };
}

/** Keep process nodes mounted so collapsing never reparents the final Markdown. */
export function useAssistantProcessDisclosure({ message, isStreaming, enabled, items, durationMs }: {
  message: Message;
  isStreaming: boolean;
  enabled: boolean;
  items: MessageContent[];
  durationMs?: number;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [reading, setReading] = useState(false);
  const [choice, setChoice] = useState<boolean | null>(null);
  const language = useLocaleStore(state => state.language);
  const t = messages(language).chat;
  const state = assistantProcessState(message, isStreaming);
  const visible = enabled && state.settled && items.length > 0;
  useEffect(() => {
    if (isStreaming) setChoice(null);
  }, [isStreaming]);
  useEffect(() => {
    if (!enabled || items.length === 0) return;
    const update = () => {
      const selection = window.getSelection();
      setReading(Boolean(contentRef.current
        && [...contentRef.current.querySelectorAll('[data-assistant-process-item]')]
          .some(element => (selection && !selection.isCollapsed && selection.containsNode(element, true))
            || element.contains(document.activeElement))));
    };
    update();
    document.addEventListener('selectionchange', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [enabled, items.length]);
  const expanded = choice ?? (!state.defaultCollapsed || reading);
  const duration = durationMs != null ? formatStepRoundDuration(durationMs, language) : null;
  const status = message.runStatus === 'cancelled' ? t.processStopped
    : message.runStatus === 'error' || state.outcome?.status === 'failed' ? t.processFailed
      : state.outcome?.status === 'partial' ? t.processPartial : null;
  const label = status ? `${status}${duration ? ` · ${duration}` : ''}`
    : duration ? t.processWorkedFor.replace('{{duration}}', duration) : t.processView;
  return {
    contentRef,
    collapsed: visible && !expanded,
    summary: visible ? <button type="button" data-assistant-process-toggle aria-expanded={expanded}
      onClick={() => setChoice(!expanded)}
      className="flex min-h-11 w-full items-center gap-1.5 border-b border-edge-subtle py-2 text-left text-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
      <span>{label}</span>
      <ChevronRight aria-hidden className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`} />
    </button> : null,
  };
}
