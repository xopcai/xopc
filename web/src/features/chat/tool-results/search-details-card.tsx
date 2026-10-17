import { useState } from 'react';

import type { ToolUseContent } from '@/features/chat/messages/messages.types';
import { readSearchDetails, searchProviderLabel } from './search-details';

export type SearchDetailsLabels = {
  provider: string; unknown: string; upstreamUnknown: string; cached: string; fresh: string; cacheUnknown: string;
  cacheHint: string; incompleteRoute: string; route: string; cachedRoute: string; attempts: string; capturedAt: string;
  outcomes: Record<string, string>; reasons: Record<string, string>;
};

/** Metadata stays inside the existing step-details disclosure, never in the collapsed title. */
export function SearchDetailsCard({ block, summary, labels, developer, language }: {
  block: Pick<ToolUseContent, 'details' | 'result'>;
  summary: string;
  labels: SearchDetailsLabels;
  developer: boolean;
  language: string;
}) {
  const [open, setOpen] = useState(false);
  const info = readSearchDetails(block);
  const label = (id?: string) => searchProviderLabel(id, labels.unknown);
  const source = info.provider === 'xopc-cloud' ? `${label(info.provider)} · ${info.upstream ? label(info.upstream) : labels.upstreamUnknown}` : label(info.provider);
  return (
    <details className="min-w-0 text-xs text-fg-muted" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer hover:text-fg">{summary}</summary>
      {open ? <div className="mt-2 space-y-2 rounded-md border border-edge px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{labels.provider}：{source}</span>
          <span className="text-fg-subtle">{info.cached === true ? labels.cached : info.cached === false ? labels.fresh : labels.cacheUnknown}</span>
        </div>
        {info.cached === true ? <p className="text-fg-subtle">{labels.cacheHint}</p> : null}
        {developer ? <div className="space-y-1 border-t border-edge pt-2 text-fg-subtle">
          {info.attemptCount !== undefined ? <p>{labels.attempts}：{info.attemptCount}</p> : null}
          {info.capturedAt !== undefined ? <p>{labels.capturedAt}：{new Date(info.capturedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</p> : null}
          {info.attemptCount !== undefined && info.attemptCount > info.attempts.length ? <p>{labels.incompleteRoute}</p> : null}
          {info.attempts.length ? <>
            <p>{info.cached === true ? labels.cachedRoute : labels.route}</p>
            <ol className="list-inside list-decimal space-y-1">
              {info.attempts.map((step, index) => <li key={index}>
                {label(step.provider)}{step.upstream ? ` · ${label(step.upstream)}` : ''} · {labels.outcomes[step.outcome] ?? labels.unknown}
                {step.reason ? ` · ${labels.reasons[step.reason] ?? labels.unknown}` : ''}
              </li>)}
            </ol>
          </> : null}
        </div> : null}
      </div> : null}
    </details>
  );
}
