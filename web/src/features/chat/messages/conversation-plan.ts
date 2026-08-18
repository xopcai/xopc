import type { Message, MessageContent, ToolUseContent } from '@/features/chat/messages/messages.types';
import type { TaskPlanState } from '@/features/chat/messages/message-sender';
import { parseToolResult } from '@/features/chat/tool-results/parse-tool-result';

export type ConversationPlanItemStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type ConversationPlan = {
  source: 'update_plan' | 'todo';
  explanation?: string;
  items: Array<{
    id: string;
    title: string;
    status: ConversationPlanItemStatus;
  }>;
  currentIndex?: number;
  completedCount: number;
  totalCount: number;
};

export type ConversationChangeSummary = {
  files: string[];
  added: number;
  removed: number;
};

export type ConversationPlanSnapshot = {
  plan: ConversationPlan;
  changeSummary: ConversationChangeSummary | null;
};

export function conversationPlanFromTaskPlanState(state: TaskPlanState): ConversationPlan | null {
  const plan = finalizePlan(state.source, state.explanation, state.items.map((item) => ({ ...item })));
  if (!plan) return null;
  const hasOpenItem = plan.items.some(
    (item) => item.status === 'pending' || item.status === 'in_progress',
  );
  return hasOpenItem ? plan : null;
}

const PLAN_STATUSES = new Set<ConversationPlanItemStatus>([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedToolName(name: string): string {
  return name.trim().toLowerCase().replace(/-/g, '_').split('__').at(-1) ?? '';
}

function toolDetails(block: ToolUseContent): Record<string, unknown> | null {
  const direct = asRecord(block.details);
  if (direct && Object.keys(direct).length > 0) return direct;
  return parseToolResult(block.result).details;
}

function normalizeStatus(value: unknown): ConversationPlanItemStatus | null {
  const status = typeof value === 'string' ? value.trim() : '';
  return PLAN_STATUSES.has(status as ConversationPlanItemStatus)
    ? (status as ConversationPlanItemStatus)
    : null;
}

function finalizePlan(
  source: ConversationPlan['source'],
  explanation: string | undefined,
  items: ConversationPlan['items'],
): ConversationPlan | null {
  if (items.length === 0) return null;
  const activeIndex = items.findIndex((item) => item.status === 'in_progress');
  return {
    source,
    explanation,
    items,
    currentIndex: activeIndex >= 0 ? activeIndex + 1 : undefined,
    completedCount: items.filter((item) => item.status === 'completed').length,
    totalCount: items.length,
  };
}

function planFromUpdatePlan(details: Record<string, unknown>): ConversationPlan | null {
  if (!Array.isArray(details.plan)) return null;
  const items = details.plan.flatMap((value, index) => {
    const item = asRecord(value);
    const id = typeof item?.id === 'string' && item.id.trim()
      ? item.id.trim()
      : `update-plan-${index}`;
    const title = typeof item?.step === 'string' ? item.step.trim() : '';
    const status = normalizeStatus(item?.status);
    return title && status
      ? [{ id, title, status }]
      : [];
  });
  const explanation = typeof details.explanation === 'string' && details.explanation.trim()
    ? details.explanation.trim()
    : undefined;
  return finalizePlan('update_plan', explanation, items);
}

function planFromTodo(details: Record<string, unknown>): ConversationPlan | null {
  if (!Array.isArray(details.items)) return null;
  const items = details.items.flatMap((value, index) => {
    const item = asRecord(value);
    const id = typeof item?.id === 'string' && item.id.trim()
      ? item.id.trim()
      : `todo-${index}`;
    const title = typeof item?.content === 'string' ? item.content.trim() : '';
    const status = normalizeStatus(item?.status);
    return title && status ? [{ id, title, status }] : [];
  });
  return finalizePlan('todo', undefined, items);
}

function findConversationPlanSnapshot(content: readonly MessageContent[]): {
  found: boolean;
  plan: ConversationPlan | null;
} {
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index];
    if (block.type !== 'tool_use' || block.status === 'error') continue;
    const name = normalizedToolName(block.name);
    const details = toolDetails(block);
    if (!details) continue;
    if (name === 'update_plan') {
      return { found: true, plan: planFromUpdatePlan(details) };
    }
    if (name === 'todo') {
      return { found: true, plan: planFromTodo(details) };
    }
  }
  return { found: false, plan: null };
}

export function extractConversationPlan(content: readonly MessageContent[]): ConversationPlan | null {
  return findConversationPlanSnapshot(content).plan;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function collectConversationChangeSummary(
  content: readonly MessageContent[],
): ConversationChangeSummary | null {
  const files = new Set<string>();
  let added = 0;
  let removed = 0;

  for (const block of content) {
    if (
      block.type !== 'tool_use'
      || block.status === 'error'
      || normalizedToolName(block.name) !== 'apply_patch'
    ) {
      continue;
    }
    const details = toolDetails(block);
    if (!details) continue;
    if (Array.isArray(details.files)) {
      for (const file of details.files) {
        if (typeof file === 'string' && file.trim()) files.add(file.trim());
      }
    }
    if (files.size === 0 && Array.isArray(details.changes)) {
      for (const value of details.changes) {
        const change = asRecord(value);
        const path = typeof change?.moveTo === 'string'
          ? change.moveTo
          : typeof change?.path === 'string'
            ? change.path
            : '';
        if (path.trim()) files.add(path.trim());
      }
    }
    added += nonNegativeNumber(details.added);
    removed += nonNegativeNumber(details.removed);
  }

  return files.size > 0 || added > 0 || removed > 0
    ? { files: [...files], added, removed }
    : null;
}

/** Latest structured plan for the current session. An empty Todo snapshot clears prior state. */
export function extractLatestConversationPlan(
  sessionMessages: readonly Message[],
): ConversationPlanSnapshot | null {
  for (let messageIndex = sessionMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = sessionMessages[messageIndex];
    if (message.role !== 'assistant') continue;
    const snapshot = findConversationPlanSnapshot(message.content ?? []);
    if (!snapshot.found) continue;
    if (!snapshot.plan) return null;
    const hasOpenItem = snapshot.plan.items.some(
      (item) => item.status === 'pending' || item.status === 'in_progress',
    );
    if (!hasOpenItem) return null;

    const contentSincePlan = sessionMessages
      .slice(messageIndex)
      .flatMap((entry) => entry.role === 'assistant' ? entry.content ?? [] : []);
    return {
      plan: snapshot.plan,
      changeSummary: collectConversationChangeSummary(contentSincePlan),
    };
  }
  return null;
}

/** Structured plan belonging to the currently active user turn only. */
export function extractActiveTurnConversationPlan(
  sessionMessages: readonly Message[],
  turnActive: boolean,
): ConversationPlanSnapshot | null {
  if (!turnActive) return null;
  let turnStart = -1;
  for (let index = sessionMessages.length - 1; index >= 0; index -= 1) {
    if (sessionMessages[index]?.role === 'user') {
      turnStart = index;
      break;
    }
  }
  return extractLatestConversationPlan(sessionMessages.slice(turnStart + 1));
}
