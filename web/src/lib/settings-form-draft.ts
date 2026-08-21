/**
 * Shared reducer shape for settings panels that mirror gateway config into local form state.
 */

export type FormDraftState<T> = {
  form: T | null;
  baseline: T | null;
};

export type FormDraftAction<T> =
  | { type: 'reset' }
  | { type: 'sync'; value: T }
  | { type: 'patch'; patch: Partial<T> }
  | { type: 'saved'; value: T }
  | { type: 'set-form'; updater: (prev: T) => T };

export function createFormDraftReducer<T extends object>() {
  return function formDraftReducer(
    state: FormDraftState<T>,
    action: FormDraftAction<T>,
  ): FormDraftState<T> {
    switch (action.type) {
      case 'reset':
        return { form: null, baseline: null };
      case 'sync': {
        const snapshot = structuredClone(action.value);
        return { form: snapshot, baseline: structuredClone(snapshot) };
      }
      case 'patch':
        return { ...state, form: state.form ? { ...state.form, ...action.patch } : null };
      case 'saved': {
        const snapshot = structuredClone(action.value);
        const current = state.form;
        const hasNewerEdits = current !== null && JSON.stringify(current) !== JSON.stringify(action.value);
        return {
          form: hasNewerEdits ? current : snapshot,
          baseline: structuredClone(snapshot),
        };
      }
      case 'set-form':
        return state.form ? { ...state, form: action.updater(state.form) } : state;
    }
  };
}

/** Render-time sync from parsed config — avoids `useEffect` mirroring derived state. */
/** Simple patch reducer for component UI state (dialogs, loading flags, etc.). */
export type UiPatchAction<T extends object> = { type: 'patch'; patch: Partial<T> };

export function uiPatchReducer<T extends object>(state: T, action: UiPatchAction<T>): T {
  return { ...state, ...action.patch };
}

export function syncFormDraftFromParsed<T>(options: {
  enabled: boolean;
  parsed: T | null;
  dirty: boolean;
  trackedParsedRef: { current: T | null };
  dispatch: (action: FormDraftAction<T>) => void;
  onResetDirty?: () => void;
}): void {
  const { enabled, parsed, dirty, trackedParsedRef, dispatch, onResetDirty } = options;
  if (!enabled) {
    if (trackedParsedRef.current !== null) {
      trackedParsedRef.current = null;
      dispatch({ type: 'reset' });
      onResetDirty?.();
    }
    return;
  }
  if (parsed !== null && !dirty && trackedParsedRef.current !== parsed) {
    trackedParsedRef.current = parsed;
    dispatch({ type: 'sync', value: parsed });
  }
}
