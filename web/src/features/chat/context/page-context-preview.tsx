import { X } from 'lucide-react';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import type { PageContextDraft } from './page-context-draft';

export function PageContextPreview({ draft, onRemove, disabled = false, waiting = false }: {
  draft: PageContextDraft; onRemove: () => void; disabled?: boolean; waiting?: boolean;
}) {
  const language = useLocaleStore(state => state.language);
  const labels = messages(language).chat.pageContext;
  return <section className="mx-4 mt-2 min-w-0 rounded-lg border border-edge bg-surface-hover p-3" aria-label={labels.label}>
    <div className="flex items-start gap-2">
      <details className="min-w-0 flex-1">
        <summary className="cursor-pointer break-words rounded text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {labels.preview}: {draft.title}
        </summary>
        <p className="mt-2 text-xs text-fg-muted">{labels.frozen}</p>
        <p className="mt-1 break-all text-xs text-fg-muted">
          {draft.envelope.resourceRefs.map(ref => `${ref.kind} · ${ref.id} · v${ref.revision}`).join(', ')}
        </p>
        <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm text-fg">{draft.preview}</pre>
        {draft.truncated ? <p className="mt-1 text-xs text-fg-muted">{labels.truncated}</p> : null}
        {draft.envelope.selection ? <>
          <p className="mt-2 text-xs font-medium text-fg">{draft.envelope.selection.draft ? labels.draft : labels.selection}</p>
          <pre className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm text-fg">{draft.envelope.selection.text}</pre>
        </> : null}
      </details>
      <button type="button" onClick={onRemove} disabled={disabled} aria-label={`${labels.remove}: ${draft.title}`}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
        <X className="size-4" aria-hidden />
      </button>
    </div>
    {waiting ? <p className="mt-2 text-xs text-fg-muted" role="status">{labels.pending}</p> : null}
  </section>;
}
