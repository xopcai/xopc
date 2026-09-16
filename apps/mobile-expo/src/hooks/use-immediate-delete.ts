import { useCallback, useEffect, useRef, useState } from 'react';

/** Hide immediately, commit without a grace period, and restore only on failure. */
export function useImmediateDelete<Id extends string>() {
  const [hiddenIds, setHiddenIds] = useState<Set<Id>>(() => new Set());
  const pending = useRef(new Set<Id>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const deleteImmediately = useCallback((id: Id, commit: () => Promise<void>, onError: (error: unknown) => void) => {
    if (pending.current.has(id)) return;
    pending.current.add(id);
    setHiddenIds(previous => new Set(previous).add(id));
    void (async () => {
      try {
        await commit();
      } catch (error) {
        if (mounted.current) {
          setHiddenIds(previous => {
            const next = new Set(previous);
            next.delete(id);
            return next;
          });
          onError(error);
        }
      } finally {
        pending.current.delete(id);
      }
    })();
  }, []);
  return { hiddenIds, deleteImmediately };
}
