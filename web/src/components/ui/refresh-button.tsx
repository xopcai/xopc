import { Check, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const MIN_BUSY_MS = 450;
const COMPLETE_MS = 900;

type RefreshClickHandler = (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;

export interface RefreshButtonProps extends Omit<ButtonProps, 'asChild' | 'children' | 'onClick'> {
  label: string;
  loading?: boolean;
  iconClassName?: string;
  strokeWidth?: number;
  onClick?: RefreshClickHandler;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function RefreshButton({
  label,
  loading = false,
  disabled = false,
  className,
  iconClassName,
  strokeWidth = 1.75,
  onClick,
  variant = 'ghost',
  type = 'button',
  title,
  'aria-label': ariaLabel,
  ...props
}: RefreshButtonProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const completeTimerRef = useRef<number | null>(null);
  const externalWasLoadingRef = useRef(false);

  const clearCompleteTimer = useCallback(() => {
    if (completeTimerRef.current !== null) {
      window.clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
  }, []);

  const showComplete = useCallback(() => {
    clearCompleteTimer();
    setComplete(true);
    completeTimerRef.current = window.setTimeout(() => {
      setComplete(false);
      completeTimerRef.current = null;
    }, COMPLETE_MS);
  }, [clearCompleteTimer]);

  useEffect(() => {
    return clearCompleteTimer;
  }, [clearCompleteTimer]);

  useEffect(() => {
    if (loading) {
      if (internalBusy) {
        externalWasLoadingRef.current = true;
      }
      setComplete(false);
      return;
    }

    if (externalWasLoadingRef.current) {
      externalWasLoadingRef.current = false;
      showComplete();
    }
  }, [internalBusy, loading, showComplete]);

  const busy = loading || internalBusy;

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled || busy) {
      event.preventDefault();
      return;
    }

    const startedAt = Date.now();
    setInternalBusy(true);
    setComplete(false);

    try {
      await onClick?.(event);
      const remainingMs = MIN_BUSY_MS - (Date.now() - startedAt);
      if (remainingMs > 0) {
        await delay(remainingMs);
      }
      showComplete();
    } finally {
      setInternalBusy(false);
    }
  };

  return (
    <Button
      type={type}
      variant={variant}
      className={cn(
        'relative overflow-hidden',
        busy && 'bg-accent/10 text-accent hover:bg-accent/15 disabled:opacity-100',
        complete && 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-300',
        className,
      )}
      disabled={disabled}
      aria-disabled={disabled || busy}
      aria-busy={busy || undefined}
      title={title ?? label}
      aria-label={ariaLabel ?? label}
      onClick={(event) => void handleClick(event)}
      {...props}
    >
      {complete && !busy ? (
        <Check className={cn('size-4 transition-transform duration-150 ease-out', iconClassName)} strokeWidth={strokeWidth} aria-hidden />
      ) : (
        <RefreshCw
          className={cn(
            'size-4 transition-transform duration-150 ease-out motion-reduce:transition-none',
            busy && 'animate-spin motion-reduce:animate-none',
            iconClassName,
          )}
          strokeWidth={strokeWidth}
          aria-hidden
        />
      )}
    </Button>
  );
}
