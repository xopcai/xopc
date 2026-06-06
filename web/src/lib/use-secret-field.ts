import { useCallback, useReducer, useRef } from 'react';

import { concealedSecretDisplay, isMaskedSecret } from '@/lib/is-masked-secret';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

type SecretFieldUiState = {
  showKey: boolean;
  /** `undefined` = not fetched; `null` = fetched, not in config file; string = plaintext from reveal */
  revealed: string | null | undefined;
  revealLoading: boolean;
  revealErr: string | null;
  copied: boolean;
};

type SecretFieldUiAction =
  | { type: 'reset-reveal' }
  | { type: 'toggle-show' }
  | { type: 'reveal-start' }
  | { type: 'reveal-success'; value: string | null }
  | { type: 'reveal-error'; message: string }
  | { type: 'copied' }
  | { type: 'clear-copied' }
  | { type: 'invalidate-reveal' };

const initialSecretFieldUi: SecretFieldUiState = {
  showKey: false,
  revealed: undefined,
  revealLoading: false,
  revealErr: null,
  copied: false,
};

function secretFieldUiReducer(state: SecretFieldUiState, action: SecretFieldUiAction): SecretFieldUiState {
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

export function useSecretField(options: {
  value: string;
  reveal?: () => Promise<string | null>;
  loadFailedLabel?: string;
  /** When set and equal to `value`, hide plaintext until the user toggles show. */
  baselineValue?: string;
}) {
  const { value, reveal, loadFailedLabel = 'Failed to load secret', baselineValue } = options;
  const [ui, dispatch] = useReducer(secretFieldUiReducer, initialSecretFieldUi);

  const masked = isMaskedSecret(value);
  const unchangedConcealed = Boolean(
    baselineValue?.trim() && value === baselineValue && !masked,
  );

  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  const trackedRef = useRef({ masked, value, unchangedConcealed });
  if (
    (!masked && !unchangedConcealed && (trackedRef.current.masked || trackedRef.current.unchangedConcealed)) ||
    (trackedRef.current.value !== value && !unchangedConcealed)
  ) {
    dispatch({ type: 'reset-reveal' });
  }
  trackedRef.current = { masked, value, unchangedConcealed };

  const inputValue = (() => {
    if (unchangedConcealed && !ui.showKey) {
      return concealedSecretDisplay(value.length);
    }
    if (!masked) return value;
    if (ui.showKey && typeof ui.revealed === 'string') return ui.revealed;
    return value;
  })();

  const inputType = (() => {
    if (unchangedConcealed && !ui.showKey) return 'password';
    if (unchangedConcealed && ui.showKey) return 'text';
    if (!masked) return ui.showKey ? 'text' : 'password';
    if (ui.showKey && typeof ui.revealed === 'string') return 'text';
    return 'password';
  })();

  const readOnly = unchangedConcealed && !ui.showKey;

  const copyText = (() => {
    if (unchangedConcealed && value.trim()) return value.trim();
    if (!masked && value.trim() && !isMaskedSecret(value)) return value.trim();
    if (typeof ui.revealed === 'string' && ui.revealed.length > 0) return ui.revealed;
    return '';
  })();

  const copyEnabled = copyText.length > 0;

  const copySecret = useCallback(async () => {
    if (!copyText) return;
    const ok = await copyTextToClipboard(copyText);
    if (!ok) return;
    dispatch({ type: 'copied' });
    window.setTimeout(() => dispatch({ type: 'clear-copied' }), 2000);
  }, [copyText]);

  const toggleEye = useCallback(async () => {
    if (unchangedConcealed || !masked) {
      dispatch({ type: 'toggle-show' });
      return;
    }
    if (ui.revealed !== undefined) {
      dispatch({ type: 'toggle-show' });
      return;
    }
    if (!revealRef.current) {
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
  }, [loadFailedLabel, masked, unchangedConcealed, ui.revealed]);

  const onInputChange = useCallback(
    (next: string, onChange: (value: string) => void) => {
      if (readOnly) return;
      if (masked && typeof ui.revealed === 'string' && ui.showKey && next !== ui.revealed) {
        dispatch({ type: 'invalidate-reveal' });
      }
      onChange(next);
    },
    [masked, readOnly, ui.revealed, ui.showKey],
  );

  const eyeDisabled =
    ui.revealLoading ||
    (!masked && !unchangedConcealed && !value.trim()) ||
    (masked && !reveal && ui.revealed === undefined);

  return {
    masked,
    unchangedConcealed,
    showKey: ui.showKey,
    revealed: ui.revealed,
    revealLoading: ui.revealLoading,
    revealErr: ui.revealErr,
    copied: ui.copied,
    inputValue,
    inputType,
    readOnly,
    copyEnabled,
    copySecret,
    toggleEye,
    onInputChange,
    eyeDisabled,
  };
}

/** @deprecated Use {@link useSecretField}. */
export const useMaskedApiKeyField = useSecretField;
