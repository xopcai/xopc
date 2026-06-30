import { buildMemoryContextBlock } from './context-fence.js';
import type { MemoryManager } from './manager.js';

export interface MemoryContextAssemblerOptions {
  memoryManager: MemoryManager;
  sessionKey: string;
  query: string;
  maxSearchResults?: number;
}

export class MemoryContextAssembler {
  async assemble(options: MemoryContextAssemblerOptions): Promise<string> {
    const query = options.query.trim();
    if (!query) return '';

    const [prefetch, searchResults] = await Promise.all([
      options.memoryManager.prefetchAll(query, { sessionId: options.sessionKey }),
      options.memoryManager.search({
        query,
        scope: { sessionKey: options.sessionKey },
        maxResults: options.maxSearchResults ?? 3,
        minScore: 0.2,
      }).catch(() => []),
    ]);

    const lines: string[] = [];
    if (prefetch.trim()) {
      lines.push(prefetch.trim());
    }
    for (const result of searchResults) {
      const path = result.citation.path ?? result.record.id;
      const range =
        result.citation.lineStart != null
          ? `#L${result.citation.lineStart}${result.citation.lineEnd && result.citation.lineEnd !== result.citation.lineStart ? `-L${result.citation.lineEnd}` : ''}`
          : '';
      lines.push(`- ${result.snippet.trim()}\n  Source: ${path}${range}`);
    }

    return buildMemoryContextBlock(lines.join('\n\n'));
  }
}
