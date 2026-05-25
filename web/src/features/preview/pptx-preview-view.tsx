import { useMemo, type ReactNode } from 'react';

import { parsePptxExtractedForDisplay } from '@/features/chat/attachments/pptx-preview-parse';

export interface PptxPreviewViewProps {
  text: string;
  slideLabel: (slideNumber: number) => string;
  emptySlideLabel: string;
}

/** Renders PPTX extracted text as slide cards instead of raw pseudo-XML. */
export function PptxPreviewView({ text, slideLabel, emptySlideLabel }: PptxPreviewViewProps) {
  const parsed = useMemo(() => parsePptxExtractedForDisplay(text), [text]);

  if (!parsed.ok) {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg">
        {parsed.raw}
      </pre>
    );
  }

  const nodes: ReactNode[] = [];

  if (parsed.notes.length > 0) {
    nodes.push(
      <div
        key="notes"
        className="mb-2 border-b border-edge-subtle pb-2 dark:border-edge"
        role="status"
      >
        {parsed.notes.map((n) => (
          <p key={n} className="text-xs text-fg-muted">
            {n}
          </p>
        ))}
      </div>,
    );
  }

  for (const slide of parsed.slides) {
    nodes.push(
      <section
        key={slide.slideNumber}
        className="rounded-lg border border-edge-subtle bg-surface-panel p-3 dark:border-edge"
      >
        <h3 className="mb-2 text-sm font-semibold text-fg">{slideLabel(slide.slideNumber)}</h3>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
          {slide.text.length > 0 ? slide.text : emptySlideLabel}
        </div>
      </section>,
    );
  }

  return <div className="flex flex-col gap-3">{nodes}</div>;
}
