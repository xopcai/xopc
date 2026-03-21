import type { Message, MessageContent, ToolUseContent } from './types.js';

export function ensureAssistantMessage(msg: Message | null | undefined, timestamp: number): Message {
  if (msg && msg.role === 'assistant') {
    return msg;
  }
  return { role: 'assistant', content: [], timestamp };
}

export function appendTextDelta(content: MessageContent[], delta: string): void {
  const last = content[content.length - 1];
  if (last?.type === 'text') {
    last.text = (last.text || '') + delta;
    return;
  }
  content.push({ type: 'text', text: delta });
}

export function appendToolStart(content: MessageContent[], toolName: string, args: unknown): void {
  const block: ToolUseContent = {
    type: 'tool_use',
    id: crypto.randomUUID(),
    name: toolName,
    input: args,
    status: 'running',
  };
  content.push(block);
}

export function completeTool(
  content: MessageContent[],
  toolName: string,
  isError: boolean,
  result?: string,
): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b.type === 'tool_use' && b.name === toolName && b.status === 'running') {
      b.status = isError ? 'error' : 'done';
      b.result = result;
      return;
    }
  }
}
