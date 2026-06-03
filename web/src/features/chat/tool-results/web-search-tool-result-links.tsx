import { ExternalLink } from 'lucide-react';

import type { WebSearchResultLink } from '@/features/chat/tool-results/web-search-tool-result-parser';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export function WebSearchToolResultLinks({ links }: { links: WebSearchResultLink[] }) {
  if (links.length === 0) {
    return null;
  }
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap gap-2">
      {links.map(({ url, title }) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-accent-soft/40 px-2 py-1 text-xs font-medium text-accent-fg',
            'max-w-xs transition-colors hover:bg-accent-soft/60 [overflow-wrap:anywhere]',
            interaction.focusRingPanel,
            interaction.press,
          )}
          title={url}
        >
          <ExternalLink className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 truncate">{title}</span>
        </a>
      ))}
    </div>
  );
}
