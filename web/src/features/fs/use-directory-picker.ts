import { useCallback, useState } from 'react';

import { pushRecentDir } from '@/features/fs/directory-path-utils';

export type UseDirectoryPickerOptions = {
  /** Opens modal at this path (web) or as native dialog default directory (Electron). */
  initialPath?: string;
  onPicked?: (path: string) => void | Promise<void>;
  /** Write path to recent list in localStorage (default true). */
  trackRecent?: boolean;
};

export type UseDirectoryPickerReturn = {
  hasNativePicker: boolean;
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  /** Electron: native dialog; browser: opens modal. */
  pick: () => void;
  /** Confirm from modal or after native pick. Re-throws when `onPicked` rejects. */
  confirmPick: (path: string) => Promise<void>;
  picking: boolean;
};

async function openNativeFolderPicker(defaultPath?: string): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.electronAPI?.file?.openDirectory : undefined;
  if (!api) return null;
  const trimmed = defaultPath?.trim();
  return trimmed ? api({ defaultPath: trimmed }) : api();
}

export function useDirectoryPicker(options: UseDirectoryPickerOptions = {}): UseDirectoryPickerReturn {
  const { initialPath, onPicked, trackRecent = true } = options;
  const [modalOpen, setModalOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  const hasNativePicker =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.file?.openDirectory);

  const confirmPick = useCallback(
    async (path: string) => {
      const t = path.trim();
      if (!t) return;
      if (trackRecent) pushRecentDir(t);
      await onPicked?.(t);
    },
    [onPicked, trackRecent],
  );

  const pick = useCallback(() => {
    if (hasNativePicker) {
      void (async () => {
        setPicking(true);
        try {
          const picked = await openNativeFolderPicker(initialPath);
          if (picked) await confirmPick(picked);
        } finally {
          setPicking(false);
        }
      })();
      return;
    }
    setModalOpen(true);
  }, [confirmPick, hasNativePicker, initialPath]);

  return {
    hasNativePicker,
    modalOpen,
    setModalOpen,
    pick,
    confirmPick,
    picking,
  };
}
