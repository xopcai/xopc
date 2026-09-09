import { Square } from 'lucide-react';

import { ReadAloudButton, type ReadAloudLabels } from '@/features/voice/read-aloud-button';
import { useReadAloudStore, type ReadAloudInput } from '@/features/voice/read-aloud-store';

export function NoteReadAloudControls({ input, labels, showLabel = true }: {
  input: () => ReadAloudInput;
  labels: ReadAloudLabels & { stop: string };
  showLabel?: boolean;
}) {
  const sourceId = input().source.id;
  const active = useReadAloudStore((state) => state.source?.type === 'note' && state.source.id === sourceId && state.status !== 'idle');
  const preparing = useReadAloudStore((state) => state.source?.type === 'note' && state.source.id === sourceId && state.status === 'preparing');
  const stop = useReadAloudStore((state) => state.stop);
  return <div className="flex items-center gap-1">
    <ReadAloudButton input={input} labels={labels} disabled={preparing} showLabel={showLabel} />
    {active ? <button
      type="button"
      onClick={stop}
      title={labels.stop}
      aria-label={labels.stop}
      className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    ><Square className="size-3.5" aria-hidden /></button> : null}
  </div>;
}
