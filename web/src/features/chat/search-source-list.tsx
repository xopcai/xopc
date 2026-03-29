import type { ToolUseContent } from '@/features/chat/messages.types';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

interface SearchSource {
  url: string;
  title: string;
  snippet?: string;
}

function extractSearchSources(blocks: ToolUseContent[]): SearchSource[] {
  const sources: SearchSource[] = [];
  for (const block of blocks) {
    if (!block.name.toLowerCase().includes('search') || !block.result) continue;
    try {
      const parsed = JSON.parse(block.result);
      const results: Array<{ url?: string; title?: string; snippet?: string }> = Array.isArray(parsed)
        ? parsed
        : (parsed?.results ?? []);
      for (const item of results) {
        if (item.url) {
          sources.push({ url: item.url, title: item.title ?? item.url, snippet: item.snippet });
        }
      }
    } catch {
      /* skip unparseable results */
    }
  }
  return sources;
}

interface SearchSourceListProps {
  blocks: Array<{ type: string; [key: string]: unknown }>;
}

export function SearchSourceList({ blocks }: SearchSourceListProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const toolBlocks = blocks.filter((b): b is ToolUseContent => b.type === 'tool_use');
  const sources = extractSearchSources(toolBlocks);

  if (sources.length === 0) return null;

  return (
    <div className="mt-6">
      <p className="mb-3 text-xs font-medium text-fg-muted">
        {m.chat.searchSourcesHeading.replace('{{count}}', String(sources.length))}
      </p>
      <ol className="space-y-3">
        {sources.map((source, index) => {
          const hostname = (() => {
            try {
              return new URL(source.url).hostname;
            } catch {
              return '';
            }
          })();
          const faviconUrl = hostname
            ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`
            : undefined;

          return (
            <li key={`${source.url}-${index}`} className="flex min-w-0 gap-2.5">
              <span className="mt-0.5 shrink-0 text-xs text-fg-disabled">{index + 1}.</span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-start gap-1.5">
                  {faviconUrl ? (
                    <img
                      src={faviconUrl}
                      alt=""
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm"
                      aria-hidden
                    />
                  ) : null}
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 break-words text-xs font-medium text-accent-fg [overflow-wrap:anywhere] hover:underline"
                  >
                    {source.title}
                  </a>
                </div>
                {source.snippet ? (
                  <p className="mt-0.5 line-clamp-4 text-xs break-words text-fg-muted [overflow-wrap:anywhere]">
                    {source.snippet}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
