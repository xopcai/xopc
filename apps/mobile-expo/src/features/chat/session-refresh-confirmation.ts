import type { Message, MessageContent, ToolUseContent } from './messages.types';

function textContent(message: Message): string {
  return message.content
    .filter((block): block is Extract<MessageContent, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\n]+/g, ' ')
    .trim();
}

function completedTools(message: Message): ToolUseContent[] {
  return message.content.filter(
    (block): block is ToolUseContent => block.type === 'tool_use' && block.status !== 'running',
  );
}

function snapshotCoversFinal(persisted: Message, finalMessage: Message): boolean {
  if (persisted.role !== 'assistant') return false;
  if (finalMessage.turnId && persisted.turnId && finalMessage.turnId !== persisted.turnId) return false;

  let hasConfirmationSignal = false;
  const finalText = textContent(finalMessage);
  if (finalText) {
    const persistedText = textContent(persisted);
    if (!persistedText || (persistedText !== finalText && !persistedText.startsWith(finalText))) {
      return false;
    }
    hasConfirmationSignal = true;
  }

  const finalTools = completedTools(finalMessage);
  if (finalTools.length > 0) {
    const persistedTools = new Map(
      completedTools(persisted).map((tool) => [tool.id || tool.toolCallId, tool]),
    );
    if (finalTools.some((tool) => !persistedTools.has(tool.id || tool.toolCallId))) return false;
    hasConfirmationSignal = true;
  }

  const finalOutcomeId = finalMessage.outcome?.outcomeId;
  if (finalOutcomeId) {
    if (persisted.outcome?.outcomeId !== finalOutcomeId) return false;
    hasConfirmationSignal = true;
  }

  if (hasConfirmationSignal) return true;
  return Boolean(finalMessage.turnId && persisted.turnId === finalMessage.turnId);
}

/**
 * Confirm that the durable history contains the completed local assistant turn.
 * Only assistants after the latest user row are eligible, so an older identical
 * answer can never cause the live final row to be discarded.
 */
export function sessionContainsFinalAssistant(
  sessionMessages: Message[],
  finalMessage: Message,
): boolean {
  if (finalMessage.role !== 'assistant') return false;
  const latestUserIndex = sessionMessages.findLastIndex(
    (message) => message.role === 'user' || message.role === 'user-with-attachments',
  );
  return sessionMessages
    .slice(latestUserIndex + 1)
    .some((message) => snapshotCoversFinal(message, finalMessage));
}
