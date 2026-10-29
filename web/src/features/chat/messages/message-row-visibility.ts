import { assistantVisibleMessage } from './assistant-visible-message';
import { buildAssistantTurnViewModel, type AssistantTurnViewModel } from './assistant-turn-view-model';
import type { Message, ReasoningLevel } from './messages.types';

export function shouldShowAssistantWorkLog(view: AssistantTurnViewModel, enabled: boolean): boolean {
  // Failed tools remain inspectable when routine activity is hidden.
  return enabled || view.workLog.items.some(item => item.type === 'tool_use'
    && (item.status === 'error' || item.activity?.status === 'failed'));
}

/** Decide before creating a list row so hidden content cannot leave a flex gap. */
export function hasVisibleMessageRow(message: Message, options: {
  personal: boolean;
  isStreaming: boolean;
  reasoningLevel: ReasoningLevel;
  showAssistantWorkLog: boolean;
  followUpTrigger?: Message['taskTrigger'];
}): boolean {
  if (message.role !== 'assistant') return true;
  if (options.isStreaming || options.followUpTrigger) return true;
  const visibleMessage = assistantVisibleMessage(message, { hideSilentReply: true });
  const view = buildAssistantTurnViewModel({ message: visibleMessage, ...options });
  return Boolean(
    view.answerContent.some(block => block.type === 'review' || (block.type === 'text' && block.text.trim()))
    || view.attachments?.length
    || view.deliveries.length
    || view.sources.length
    || (view.outcome && (view.outcome.status === 'failed' || view.outcome.changeSet
      || view.outcome.evidence.length || view.outcome.deliverables.length))
    || message.taskResultDelivery
    || message.personalProvenance
    || (shouldShowAssistantWorkLog(view, options.showAssistantWorkLog) && view.workLog.items.some(item =>
      options.personal || (!view.workLog.compact && options.showAssistantWorkLog)
      || (item.type === 'tool_use' && (item.status === 'error' || item.activity?.status === 'failed')))),
  );
}
