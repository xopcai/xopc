import { Key, matchesKey } from '@mariozechner/pi-tui';

/** Suppress duplicate backspace bursts from some terminals (openclaw-aligned). */
export function createBackspaceDeduper(params?: { dedupeWindowMs?: number; now?: () => number }) {
  const dedupeWindowMs = Math.max(0, Math.floor(params?.dedupeWindowMs ?? 8));
  const now = params?.now ?? (() => Date.now());
  let lastBackspaceAt = -1;

  return (data: string): string => {
    if (data !== '\x08' && !matchesKey(data, Key.backspace)) {
      return data;
    }
    const ts = now();
    if (lastBackspaceAt >= 0 && ts - lastBackspaceAt <= dedupeWindowMs) {
      return '';
    }
    lastBackspaceAt = ts;
    return data;
  };
}

export function isIgnorableTuiStopError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { code?: unknown; syscall?: unknown; message?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  const syscall = typeof err.syscall === 'string' ? err.syscall : '';
  const message = typeof err.message === 'string' ? err.message : '';
  if (code === 'EBADF' && syscall === 'setRawMode') {
    return true;
  }
  return /setRawMode/i.test(message) && /EBADF/i.test(message);
}

export function stopTuiSafely(stop: () => void): void {
  try {
    stop();
  } catch (error) {
    if (!isIgnorableTuiStopError(error)) {
      throw error;
    }
  }
}

export type DrainableTui = {
  stop: () => void;
  terminal?: {
    drainInput?: (maxMs?: number, idleMs?: number) => Promise<void>;
  };
};

export async function drainAndStopTuiSafely(tui: DrainableTui): Promise<void> {
  if (typeof tui.terminal?.drainInput === 'function') {
    try {
      await tui.terminal.drainInput();
    } catch {
      // Best-effort only.
    }
  }
  stopTuiSafely(() => tui.stop());
}

type CtrlCAction = 'clear' | 'warn' | 'exit';

/** Double Ctrl+C within `exitWindowMs` to exit when the input line is empty (openclaw semantics). */
export function resolveCtrlCAction(params: {
  hasInput: boolean;
  now: number;
  lastCtrlCAt: number;
  exitWindowMs?: number;
}): { action: CtrlCAction; nextLastCtrlCAt: number } {
  const exitWindowMs = Math.max(1, Math.floor(params.exitWindowMs ?? 1000));
  if (params.hasInput) {
    return { action: 'clear', nextLastCtrlCAt: params.now };
  }
  if (params.now - params.lastCtrlCAt <= exitWindowMs) {
    return { action: 'exit', nextLastCtrlCAt: params.lastCtrlCAt };
  }
  return { action: 'warn', nextLastCtrlCAt: params.now };
}
