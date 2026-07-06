import { useCallback, useState } from 'react';

import { hapticSelectionEnter } from '../motion/haptics';

export function useListSelection<TId extends string>() {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<TId>>(() => new Set());

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const startSelection = useCallback(() => {
    hapticSelectionEnter();
    setSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  const toggleSelected = useCallback((id: TId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  return {
    selectionMode,
    selectedIds,
    selectedCount: selectedIds.size,
    exitSelectionMode,
    startSelection,
    toggleSelected,
  };
}
