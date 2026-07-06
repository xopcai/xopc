import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { analyzeIntakeContent, shouldOfferContentIntake, type ContentIntakeIntent } from '../content-intake/content-intent';
import { isLatestAppClipboardHash } from './app-clipboard-origin';
import { hashClipboardText } from './clipboard-hash';
import { isClipboardHashHandled, rememberClipboardHashHandled } from './clipboard-intake-store';

export type ClipboardCandidate = {
  text: string;
  hash: string;
  intent: ContentIntakeIntent;
};

export function useClipboardIntake(enabled: boolean): {
  candidate: ClipboardCandidate | null;
  markHandled: () => void;
} {
  const [candidate, setCandidate] = useState<ClipboardCandidate | null>(null);
  const lastHashRef = useRef<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const checkingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearScheduledCheck = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const markHandled = useCallback(() => {
    setCandidate((current) => {
      if (current) {
        lastHashRef.current = current.hash;
        rememberClipboardHashHandled(current.hash);
      }
      return null;
    });
  }, []);

  const checkClipboard = useCallback(async () => {
    if (!enabled || candidate || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const hasText = await Clipboard.hasStringAsync();
      if (!hasText) return;
      const text = (await Clipboard.getStringAsync()).trim();
      if (!text) return;
      const hash = hashClipboardText(text);
      if (hash === lastHashRef.current) return;
      if (isClipboardHashHandled(hash)) {
        lastHashRef.current = hash;
        return;
      }
      if (isLatestAppClipboardHash(hash)) {
        lastHashRef.current = hash;
        rememberClipboardHashHandled(hash);
        return;
      }
      if (!shouldOfferContentIntake(text)) {
        lastHashRef.current = hash;
        rememberClipboardHashHandled(hash);
        return;
      }
      setCandidate({ text, hash, intent: analyzeIntakeContent(text) });
    } catch {
      // Clipboard availability varies by platform and privacy state; ignore read failures.
    } finally {
      checkingRef.current = false;
    }
  }, [candidate, enabled]);

  const scheduleCheck = useCallback(() => {
    clearScheduledCheck();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void checkClipboard();
    }, 700);
  }, [checkClipboard, clearScheduledCheck]);

  useEffect(() => {
    if (!enabled) {
      clearScheduledCheck();
      setCandidate(null);
      return undefined;
    }
    scheduleCheck();
    return clearScheduledCheck;
  }, [clearScheduledCheck, enabled, scheduleCheck]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;
      if (enabled && (previous === 'background' || previous === 'inactive') && nextState === 'active') {
        scheduleCheck();
      }
    });
    return () => {
      sub.remove();
      clearScheduledCheck();
    };
  }, [clearScheduledCheck, enabled, scheduleCheck]);

  return { candidate, markHandled };
}
