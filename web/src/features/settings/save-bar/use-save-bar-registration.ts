import { useEffect, useRef } from 'react';

import { useSaveBarStore } from './save-bar-store';

interface RegistrationArgs {
  /** Unique stable id (e.g. `providers`, `voice`). */
  id: string;
  dirty: boolean;
  saving: boolean;
  /** Per-section save. May throw or return void; the hook wraps it. */
  save: () => Promise<unknown>;
  discard: () => void;
}

/**
 * Registers a settings panel with the hub-level save bar. Each panel calls
 * this once with its current dirty/saving state and stable save/discard
 * callbacks. The hook keeps the panel's entry in the store fresh and
 * deregisters on unmount.
 *
 * `save` and `discard` are read through latest-refs, so they don't need to
 * be `useCallback`-stabilised at the call site — the registered handle
 * always invokes the most recent closure.
 */
export function useSaveBarRegistration({
  id,
  dirty,
  saving,
  save,
  discard,
}: RegistrationArgs): void {
  const saveRef = useRef(save);
  const discardRef = useRef(discard);
  saveRef.current = save;
  discardRef.current = discard;

  const registerSection = useSaveBarStore((s) => s.registerSection);
  const unregisterSection = useSaveBarStore((s) => s.unregisterSection);

  useEffect(() => {
    registerSection({
      id,
      dirty,
      saving,
      save: async () => {
        try {
          await saveRef.current();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      discard: () => discardRef.current(),
    });
    return () => unregisterSection(id);
    // `dirty` / `saving` change on every form keystroke; we re-register so
    // the hub sees fresh values. `save`/`discard` are pinned via refs and
    // intentionally excluded.
  }, [id, dirty, saving, registerSection, unregisterSection]);
}
