import type { ToolUseContent } from '@/features/chat/messages/messages.types';
import { parseToolResult } from './parse-tool-result';

export type SearchDetails = {
  provider?: string;
  upstream?: string;
  cached?: boolean;
  capturedAt?: number;
  attemptCount?: number;
  attempts: Array<{ provider: string; upstream?: string; outcome: string; reason?: string }>;
};

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;
const identifier = (value: unknown): string | undefined => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) ? value : undefined;

export function readSearchDetails(block: Pick<ToolUseContent, 'details' | 'result'>): SearchDetails {
  const parsed = parseToolResult(block.result).details;
  const details = { ...parsed, ...record(block.details) };
  const info = record(details?.searchInfo) ?? details;
  const attempts = Array.isArray(info?.attempts) ? info.attempts.slice(0, 24).flatMap((item: unknown) => {
    const row = record(item);
    const provider = identifier(row?.provider);
    if (!provider || !['success', 'empty', 'error', 'skipped'].includes(String(row?.outcome))) return [];
    return [{ provider, upstream: identifier(row?.upstream), outcome: String(row?.outcome), reason: identifier(row?.reason) }];
  }) : [];
  return {
    provider: identifier(info?.provider), upstream: identifier(info?.upstream),
    cached: typeof info?.cached === 'boolean' ? info.cached : undefined,
    capturedAt: typeof info?.capturedAt === 'number' && Number.isSafeInteger(info.capturedAt) && info.capturedAt > 0 ? info.capturedAt : undefined,
    attemptCount: typeof info?.attemptCount === 'number' && Number.isSafeInteger(info.attemptCount) && info.attemptCount > 0 && info.attemptCount <= 10000 ? info.attemptCount : undefined,
    attempts,
  };
}

export function searchProviderLabel(id: string | undefined, unknownLabel: string): string {
  return ({ deepseek: 'DeepSeek', 'xopc-cloud': 'XOPC Cloud', tavily: 'Tavily', brave: 'Brave', bing: 'Bing',
    searxng: 'SearXNG', 'bing-html': 'Bing HTML', 'duckduckgo-html': 'DuckDuckGo HTML', html: 'HTML' } as Record<string, string>)[id ?? ''] ?? unknownLabel;
}
