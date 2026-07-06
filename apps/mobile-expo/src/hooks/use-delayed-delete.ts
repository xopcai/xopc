import { useCallback, useEffect, useRef, useState } from 'react';

import { LIST_DELETE_UNDO_MS } from '../constants/list-interaction';

type PendingDelete<Id> = {
  id: Id;
  timer: ReturnType<typeof setTimeout>;
};

export function useDelayedDelete<Id extends string>() {
  const [hiddenIds, setHiddenIds] = useState<Set<Id>>(() => new Set());
  const [undoId, setUndoId] = useState<Id | null>(null);
  const pendingRef = useRef<Map<Id, PendingDelete<Id>>>(new Map());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const scheduleDelete = useCallback(
    (id: Id, commit: () => Promise<void>, onError: (error: unknown) => void) => {
      const existing = pendingRef.current.get(id);
      if (existing) clearTimeout(existing.timer);

      setHiddenIds((prev) => new Set(prev).add(id));
      setUndoId(id);

      const timer = setTimeout(() => {
        pendingRef.current.delete(id);
        void commit()
          .catch((error) => {
            if (!mountedRef.current) return;
            setHiddenIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            onError(error);
          })
          .finally(() => {
            if (!mountedRef.current) return;
            setUndoId((current) => current === id ? null : current);
          });
      }, LIST_DELETE_UNDO_MS);

      pendingRef.current.set(id, { id, timer });
    },
    [],
  );

  const undoDelete = useCallback((id: Id | null = undoId) => {
    if (!id) return;
    const pending = pendingRef.current.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRef.current.delete(id);
    }
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setUndoId((current) => current === id ? null : current);
  }, [undoId]);

  return {
    hiddenIds,
    undoId,
    scheduleDelete,
    undoDelete,
  };
}
