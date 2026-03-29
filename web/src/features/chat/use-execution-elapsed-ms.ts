import { useEffect, useRef, useState } from 'react';

/**
 * Monotonic elapsed time while `active` is true (resets when execution stops).
 * Updates every 250ms for smooth second ticks.
 */
export function useExecutionElapsedMs(active: boolean): number {
  const [ms, setMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setMs(0);
      return;
    }
    if (startRef.current == null) {
      startRef.current = Date.now();
    }
    const tick = () => {
      if (startRef.current != null) {
        setMs(Date.now() - startRef.current);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [active]);

  return ms;
}
