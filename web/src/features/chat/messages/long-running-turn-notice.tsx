import { Loader2, Square } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

const LONG_RUNNING_DELAY_MS = 10_000;

export function LongRunningTurnNotice({
  running,
  title,
  description,
  stopLabel,
  onStop,
}: {
  running: boolean;
  title: string;
  description: string;
  stopLabel: string;
  onStop: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!running) {
      setVisible(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setVisible(true), LONG_RUNNING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [running]);

  if (!running || !visible) return null;

  return (
    <div
      className="mb-2 flex items-start gap-2.5 rounded-xl border border-accent/20 bg-accent-soft/35 px-3 py-2.5 dark:bg-accent-soft/20"
    >
      <Loader2
        className="mt-0.5 size-4 shrink-0 animate-spin text-accent-fg"
        aria-hidden
      />
      <div className="min-w-0 flex-1" role="status" aria-live="polite">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-fg-muted">{description}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        className="h-8 shrink-0 gap-1.5 px-2 text-xs"
        onClick={onStop}
      >
        <Square className="size-3" aria-hidden />
        {stopLabel}
      </Button>
    </div>
  );
}
