import type { Message } from '@/features/chat/messages.types';

export function UsageBadge({ usage }: { usage: NonNullable<Message['usage']> }) {
  const parts: string[] = [];
  if (usage.totalTokens !== undefined) {
    parts.push(`${usage.totalTokens} tokens`);
  } else if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    parts.push(`${usage.inputTokens + usage.outputTokens} tokens`);
  }
  if (usage.cost !== undefined && usage.cost > 0) {
    parts.push(`$${usage.cost.toFixed(4)}`);
  }
  if (parts.length === 0) return null;
  return <span className="text-[11px] text-fg-disabled">{parts.join(' · ')}</span>;
}
