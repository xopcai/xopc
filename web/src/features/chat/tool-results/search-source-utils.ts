import type { ToolUseContent } from '@/features/chat/messages/messages.types';

export interface SearchSource {
  url: string;
  title: string;
  snippet?: string;
}

export function extractSearchSources(blocks: ToolUseContent[]): SearchSource[] {
  const sources: SearchSource[] = [];
  for (const block of blocks) {
    if (!block.name.toLowerCase().includes('search') || block.result == null) continue;
    try {
      const parsed =
        typeof block.result === 'string'
          ? JSON.parse(block.result)
          : (block.result as Record<string, unknown>);
      const results: Array<{ url?: string; title?: string; snippet?: string }> = Array.isArray(parsed)
        ? parsed
        : (parsed?.results ?? []);
      for (const item of results) {
        if (item.url) {
          sources.push({ url: item.url, title: item.title ?? item.url, snippet: item.snippet });
        }
      }
    } catch {
      // Ignore tool results that are not valid search payloads.
    }
  }
  return sources;
}
