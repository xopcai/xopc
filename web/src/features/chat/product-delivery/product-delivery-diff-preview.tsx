import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type DiffPresentation = Extract<NonNullable<ProductDeliveryEnvelope['presentation']>, { kind: 'diff' }>;

/** Read-only preview. A historical result never carries write or approval authority. */
export function ProductDeliveryDiffPreview({ presentation }: { presentation: DiffPresentation }) {
  const language = useLocaleStore(state => state.language);
  const t = messages(language).chat.productDelivery;

  return (
    <section className="mt-2 rounded-lg border border-edge bg-surface-panel p-3" aria-label={t.diffPreview}>
      <h3 className="text-sm font-medium text-fg">{t.proposedChanges}</h3>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-muted">{presentation.title}</p>
      <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
        {presentation.edits.map((edit, index) => (
          <details key={index} className="rounded border border-edge-subtle p-2">
            <summary className="cursor-pointer rounded text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {t.replaceRange} {edit.from}–{edit.to}
            </summary>
            <pre className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-xs text-fg">{edit.text}</pre>
          </details>
        ))}
      </div>
      {presentation.truncated ? (
        <p role="status" className="mt-2 text-xs text-fg-muted">
          {t.partialDiff}
        </p>
      ) : null}
    </section>
  );
}
