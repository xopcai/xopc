import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

type UseAutosaveOptions<T> = {
  value: T | null;
  dirty: boolean;
  onSave: (snapshot: T) => Promise<void>;
  enabled?: boolean;
  delayMs?: number;
  validate?: (snapshot: T) => string | null;
  serialize?: (snapshot: T) => string;
};

export function useAutosave<T>({
  value,
  dirty,
  onSave,
  enabled = true,
  delayMs = 700,
  validate,
  serialize = JSON.stringify,
}: UseAutosaveOptions<T>) {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef(value);
  const onSaveRef = useRef(onSave);
  const validateRef = useRef(validate);
  const serializeRef = useRef(serialize);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef<T | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const lastAttemptedSignatureRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  valueRef.current = value;
  onSaveRef.current = onSave;
  validateRef.current = validate;
  serializeRef.current = serialize;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const run = useCallback(async (snapshot: T) => {
    clearTimer();
    const signature = serializeRef.current(snapshot);
    lastAttemptedSignatureRef.current = signature;
    const validationError = validateRef.current?.(snapshot) ?? null;
    if (validationError) {
      setError(validationError);
      setStatus('error');
      return;
    }
    if (inFlightRef.current) {
      queuedRef.current = snapshot;
      return;
    }

    inFlightRef.current = true;
    setError(null);
    setStatus('saving');
    try {
      await onSaveRef.current(snapshot);
      lastSavedSignatureRef.current = signature;
      if (mountedRef.current) setStatus('saved');
    } catch (cause) {
      if (mountedRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      }
    } finally {
      inFlightRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued && serializeRef.current(queued) !== lastSavedSignatureRef.current) {
        void run(queued);
      }
    }
  }, [clearTimer]);

  const flush = useCallback(() => {
    const snapshot = valueRef.current;
    if (!enabled || !dirty || snapshot === null) return;
    void run(snapshot);
  }, [dirty, enabled, run]);

  const saveNow = useCallback((snapshot?: T) => {
    const next = snapshot ?? valueRef.current;
    if (!enabled || next === null) return;
    void run(next);
  }, [enabled, run]);

  useEffect(() => {
    if (!enabled || !dirty || value === null) {
      clearTimer();
      if (!dirty && status === 'dirty') setStatus('idle');
      return;
    }
    const signature = serialize(value);
    if (signature === lastSavedSignatureRef.current) return;
    if (status === 'error' && signature === lastAttemptedSignatureRef.current) return;
    setStatus((current) => current === 'saving' ? current : 'dirty');
    clearTimer();
    timerRef.current = window.setTimeout(() => void run(value), delayMs);
    return clearTimer;
  }, [clearTimer, delayMs, dirty, enabled, run, serialize, status, value]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  return {
    status,
    error,
    flush,
    saveNow,
    retry: flush,
    onBlurCapture: flush,
  };
}
