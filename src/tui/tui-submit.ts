/**
 * Submit handling aligned with openclaw: `!` local shell lines + paste burst coalescing
 * for terminals that split multiline paste into rapid single-line submits.
 */

function normalizeLowercaseStringOrEmpty(value: string): string {
  return value.trim().toLowerCase();
}

export function createEditorSubmitHandler(params: {
  editor: {
    setText: (value: string) => void;
    addToHistory: (value: string) => void;
  };
  handleCommand: (value: string) => void | Promise<void>;
  sendMessage: (value: string) => void | Promise<void>;
  handleBangLine: (value: string) => void | Promise<void>;
  isAgentBusy?: () => boolean;
  steerWhileBusy?: (value: string) => void | Promise<void>;
  hasPendingAttachments?: () => boolean;
  defaultAttachmentMessage?: string;
}) {
  return (text: string) => {
    const raw = text;
    const hasAttachments = params.hasPendingAttachments?.() === true;
    const value = raw.trim() || (hasAttachments ? (params.defaultAttachmentMessage ?? 'Please analyze the attachment(s).') : '');
    params.editor.setText('');

    if (!value) {
      return;
    }

    if (raw.startsWith('!') && raw !== '!') {
      params.editor.addToHistory(raw);
      void params.handleBangLine(raw);
      return;
    }

    params.editor.addToHistory(value);

    if (value.startsWith('/')) {
      void params.handleCommand(value);
      return;
    }

    if (params.isAgentBusy?.() && params.steerWhileBusy) {
      void params.steerWhileBusy(value);
      return;
    }

    void params.sendMessage(value);
  };
}

export function shouldEnableWindowsGitBashPasteFallback(params?: {
  platform?: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const platform = params?.platform ?? process.platform;
  const env = params?.env ?? process.env;
  const termProgram = normalizeLowercaseStringOrEmpty(env.TERM_PROGRAM ?? '');

  if (platform === 'darwin') {
    if (termProgram.includes('iterm') || termProgram.includes('apple_terminal')) {
      return true;
    }
    return false;
  }

  if (platform !== 'win32') {
    return false;
  }

  const msystem = (env.MSYSTEM ?? '').toUpperCase();
  const shell = env.SHELL ?? '';
  if (msystem.startsWith('MINGW') || msystem.startsWith('MSYS')) {
    return true;
  }
  if (normalizeLowercaseStringOrEmpty(shell).includes('bash')) {
    return true;
  }
  return termProgram.includes('mintty');
}

export function createSubmitBurstCoalescer(params: {
  submit: (value: string) => void;
  enabled: boolean;
  burstWindowMs?: number;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}) {
  const windowMs = Math.max(1, params.burstWindowMs ?? 50);
  const now = params.now ?? (() => Date.now());
  const setTimer = params.setTimer ?? setTimeout;
  const clearTimer = params.clearTimer ?? clearTimeout;
  let pending: string | null = null;
  let pendingAt = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const clearFlushTimer = () => {
    if (!flushTimer) {
      return;
    }
    clearTimer(flushTimer);
    flushTimer = null;
  };

  const flushPending = () => {
    if (pending === null) {
      return;
    }
    const flushed = pending;
    pending = null;
    pendingAt = 0;
    clearFlushTimer();
    params.submit(flushed);
  };

  const scheduleFlush = () => {
    clearFlushTimer();
    flushTimer = setTimer(() => {
      flushPending();
    }, windowMs);
  };

  return (value: string) => {
    if (!params.enabled) {
      params.submit(value);
      return;
    }
    if (value.includes('\n')) {
      flushPending();
      params.submit(value);
      return;
    }
    const ts = now();
    if (pending === null) {
      pending = value;
      pendingAt = ts;
      scheduleFlush();
      return;
    }
    if (ts - pendingAt <= windowMs) {
      pending = `${pending}\n${value}`;
      pendingAt = ts;
      scheduleFlush();
      return;
    }
    flushPending();
    pending = value;
    pendingAt = ts;
    scheduleFlush();
  };
}
