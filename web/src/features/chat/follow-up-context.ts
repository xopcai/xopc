import type { FollowUpPromptLocale } from '@/features/chat/follow-up-prompts';
import type { Message, MessageContent } from '@/features/chat/messages.types';

const MAX_ASSISTANT_CHARS = 1200;
const MAX_USER_CHARS = 800;
const MAX_RECENT_USER_SNIPPET = 200;
const MAX_RECENT_ASSISTANT_SNIPPET = 400;
const MAX_TOOL_RESULT_PREVIEW = 200;
const MAX_TOOL_USES = 12;

export type ToolUseSummary = {
  name: string;
  status: 'running' | 'done' | 'error';
  resultPreview?: string;
};

export type FollowUpCapabilities = {
  capWebSearch: boolean;
  capWebFetch: boolean;
  capShell: boolean;
  capBrowser: boolean;
  capCron: boolean;
};

export const DEFAULT_FOLLOW_UP_CAPABILITIES: FollowUpCapabilities = {
  capWebSearch: true,
  capWebFetch: true,
  capShell: true,
  capBrowser: true,
  capCron: true,
};

export type FollowUpContextPack = {
  locale: FollowUpPromptLocale;
  clarifyActive: boolean;
  channel: string;
  userText: string;
  userHasAttachments: boolean;
  assistantText: string;
  assistantHasThinking: boolean;
  assistantToolUses: ToolUseSummary[];
  priorTurnCount: number;
  recentUserTexts: string[];
  recentAssistantSnippet: string;
  capabilities: FollowUpCapabilities;
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function collectPlainTextFromContent(content: MessageContent[]): string {
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === 'text' && b.text?.trim()) {
      parts.push(b.text.trim());
    }
  }
  return parts.join('\n').trim();
}

function isUserRole(role: Message['role']): boolean {
  return role === 'user' || role === 'user-with-attachments';
}

function summarizeToolUses(content: MessageContent[]): ToolUseSummary[] {
  const out: ToolUseSummary[] = [];
  for (const b of content) {
    if (b.type !== 'tool_use') continue;
    let resultPreview: string | undefined;
    if (b.result != null) {
      const raw = typeof b.result === 'string' ? b.result : JSON.stringify(b.result);
      const t = raw.trim();
      if (t) {
        resultPreview = truncate(t, MAX_TOOL_RESULT_PREVIEW);
      }
    }
    out.push({
      name: b.name,
      status: b.status,
      resultPreview,
    });
  }
  return out.slice(-MAX_TOOL_USES);
}

function findTriggeringUserIndex(messages: Message[], assistantIndex: number): number {
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (isUserRole(messages[i].role)) return i;
  }
  return -1;
}

export type BuildFollowUpContextInput = {
  messages: Message[];
  appendedAssistant: Message;
  locale?: FollowUpPromptLocale;
  clarifyActive?: boolean;
  channel?: string;
  capabilities?: Partial<FollowUpCapabilities>;
};

/**
 * Assemble scoring context after an assistant turn (no extra LLM).
 * `messages` must include `appendedAssistant` as the last assistant message.
 */
export function buildFollowUpContextPack(input: BuildFollowUpContextInput): FollowUpContextPack | null {
  const { messages, appendedAssistant } = input;
  if (appendedAssistant.role !== 'assistant') return null;

  const assistantTextRaw = collectPlainTextFromContent(appendedAssistant.content);
  if (!assistantTextRaw) return null;

  let assistantIndex = messages.length - 1;
  while (assistantIndex >= 0 && messages[assistantIndex] !== appendedAssistant) {
    assistantIndex--;
  }
  if (assistantIndex < 0) {
    assistantIndex = messages.length - 1;
  }

  const userIdx = findTriggeringUserIndex(messages, assistantIndex);
  const userMsg = userIdx >= 0 ? messages[userIdx] : null;
  const userTextRaw = userMsg ? collectPlainTextFromContent(userMsg.content) : '';

  const priorUsers: string[] = [];
  for (let i = userIdx - 1; i >= 0 && priorUsers.length < 2; i--) {
    const m = messages[i];
    if (!isUserRole(m.role)) continue;
    const t = collectPlainTextFromContent(m.content);
    if (t) priorUsers.unshift(truncate(t, MAX_RECENT_USER_SNIPPET));
  }

  let recentAssistantSnippet = '';
  for (let i = assistantIndex - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const t = collectPlainTextFromContent(m.content);
    if (t) {
      recentAssistantSnippet = truncate(t, MAX_RECENT_ASSISTANT_SNIPPET);
      break;
    }
  }

  let priorTurnCount = 0;
  for (const m of messages) {
    if (isUserRole(m.role)) priorTurnCount += 1;
  }

  const capabilities: FollowUpCapabilities = {
    ...DEFAULT_FOLLOW_UP_CAPABILITIES,
    ...input.capabilities,
  };

  const assistantHasThinking = appendedAssistant.content.some(
    (b) => b.type === 'thinking' && (b.text?.trim() ?? '').length > 0,
  );

  return {
    locale: input.locale ?? 'en',
    clarifyActive: input.clarifyActive ?? false,
    channel: input.channel ?? 'webchat',
    userText: truncate(userTextRaw, MAX_USER_CHARS),
    userHasAttachments: Boolean(userMsg?.attachments?.length),
    assistantText: truncate(assistantTextRaw, MAX_ASSISTANT_CHARS),
    assistantHasThinking,
    assistantToolUses: summarizeToolUses(appendedAssistant.content),
    priorTurnCount,
    recentUserTexts: priorUsers,
    recentAssistantSnippet,
    capabilities,
  };
}
