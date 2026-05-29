import { useCallback, useReducer, useRef } from 'react';

import { isMaskedKey } from '@/features/settings/providers-api';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

type MaskedApiKeyUiState = {
  showKey: boolean;
  /** `undefined` = not fetched; `null` = fetched, not in config file; string = plaintext from config */
  revealed: string | null | undefined;
  revealLoading: boolean;
  revealErr: string | null;
  copied: boolean;
};

type MaskedApiKeyUiAction =
  | { type: 'reset-reveal' }
  | { type: 'toggle-show' }
  | { type: 'reveal-start' }
  | { type: 'reveal-success'; value: string | null }
  | { type: 'reveal-error'; message: string }
  | { type: 'copied' }
  | { type: 'clear-copied' }
  | { type: 'invalidate-reveal' };

const initialMaskedApiKeyUi: MaskedApiKeyUiState = {
  showKey: false,
  revealed: undefined,
  revealLoading: false,
  revealErr: null,
  copied: false,
};

function maskedApiKeyUiReducer(
  state: MaskedApiKeyUiState,
  action: MaskedApiKeyUiAction,
): MaskedApiKeyUiState {
  switch (action.type) {
    case 'reset-reveal':
      return { ...state, showKey: false, revealed: undefined, revealErr: null };
    case 'toggle-show':
      return { ...state, showKey: !state.showKey };
    case 'reveal-start':
      return { ...state, revealLoading: true, revealErr: null };
    case 'reveal-success':
      return {
        ...state,
        revealed: action.value,
        revealLoading: false,
        showKey: true,
        revealErr: null,
      };
    case 'reveal-error':
      return {
        ...state,
        revealed: null,
        revealLoading: false,
        revealErr: action.message,
      };
    case 'copied':
      return { ...state, copied: true };
    case 'clear-copied':
      return { ...state, copied: false };
    case 'invalidate-reveal':
      return { ...state, revealed: undefined, showKey: false };
  }
}

export function useMaskedApiKeyField(options: {
  value: string;
  reveal: () => Promise<string | null>;
  loadFailedLabel: string;
}) {
  const { value, reveal, loadFailedLabel } = options;
  const [ui, dispatch] = useReducer(maskedApiKeyUiReducer, initialMaskedApiKeyUi);

  const masked = isMaskedKey(value);
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  const trackedMaskedRef = useRef({ masked, value });
  if (
    !masked &&
    (trackedMaskedRef.current.masked || trackedMaskedRef.current.value !== value)
  ) {
    dispatch({ type: 'reset-reveal' });
  }
  trackedMaskedRef.current = { masked, value };

  const inputValue = (() => {
    if (!masked) return value;
    if (ui.showKey && typeof ui.revealed === 'string') return ui.revealed;
    return value;
  })();

  const inputType =
    !masked || (masked && ui.showKey && typeof ui.revealed === 'string')
      ? ('text' as const)
      : ('password' as const);

  const copyEnabled =
    (!masked && value.trim().length > 0 && !isMaskedKey(value)) ||
    (Boolean(ui.showKey) && typeof ui.revealed === 'string' && ui.revealed.length > 0);

  const copyKey = useCallback(async () => {
    const text =
      !masked && value.trim() && !isMaskedKey(value)
        ? value.trim()
        : typeof ui.revealed === 'string' && ui.revealed.length > 0
          ? ui.revealed
          : '';
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    dispatch({ type: 'copied' });
    window.setTimeout(() => dispatch({ type: 'clear-copied' }), 2000);
  }, [masked, ui.revealed, value]);

  const toggleEye = useCallback(async () => {
    if (!masked) {
      dispatch({ type: 'toggle-show' });
      return;
    }
    if (ui.revealed !== undefined) {
      dispatch({ type: 'toggle-show' });
      return;
    }
    dispatch({ type: 'reveal-start' });
    try {
      const plaintext = await revealRef.current();
      dispatch({ type: 'reveal-success', value: plaintext });
    } catch (e) {
      dispatch({
        type: 'reveal-error',
        message: e instanceof Error ? e.message : loadFailedLabel,
      });
    }
  }, [loadFailedLabel, masked, ui.revealed]);

  const onInputChange = useCallback(
    (next: string, onChange: (value: string) => void) => {
      if (masked && typeof ui.revealed === 'string' && ui.showKey && next !== ui.revealed) {
        dispatch({ type: 'invalidate-reveal' });
      }
      onChange(next);
    },
    [masked, ui.revealed, ui.showKey],
  );

  return {
    masked,
    showKey: ui.showKey,
    revealed: ui.revealed,
    revealLoading: ui.revealLoading,
    revealErr: ui.revealErr,
    copied: ui.copied,
    inputValue,
    inputType,
    copyEnabled,
    copyKey,
    toggleEye,
    onInputChange,
  };
}
