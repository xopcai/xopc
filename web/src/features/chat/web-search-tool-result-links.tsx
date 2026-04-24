import { ExternalLink } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export type WebSearchResultLink = { url: string; title: string };

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Parses serialized `web_search` tool output (JSON with `details.results` from the agent).
 */
export function extractWebSearchLinksFromToolResult(resultText: string): WebSearchResultLink[] {
  if (!resultText?.trim()) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  const rec = parsed as Record<string, unknown>;
  const details = rec.details;
  let results: unknown[] = [];
  if (details && typeof details === 'object') {
    const r = (details as Record<string, unknown>).results;
    if (Array.isArray(r)) {
      results = r;
    }
  }
  if (results.length === 0 && Array.isArray(rec.results)) {
    results = rec.results;
  }
  const out: WebSearchResultLink[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Record<string, unknown>;
    const u = row.url;
    if (typeof u !== 'string' || !u.trim()) {
      continue;
    }
    const url = u.trim();
    if (!/^https?:\/\//i.test(url)) {
      continue;
    }
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    const rawTitle = row.title;
    const title =
      typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle.trim() : hostnameFromUrl(url);
    out.push({ url, title });
  }
  return out;
}

export function isWebSearchToolName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === 'web_search' || n === 'brave_search';
}

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
          <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 truncate">{title}</span>
        </a>
      ))}
    </div>
  );
}
