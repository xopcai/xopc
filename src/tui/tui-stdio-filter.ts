/**
 * While pi-tui owns the screen, strip whole-line pino JSON from stdout/stderr.
 * ANSI chunks must pass through immediately (see runTui).
 *
 * Longer-term (openclaw-style): prefer routing logger transports away from stdout when the TUI
 * is active (e.g. file-only + explicit subsystem tags) instead of patching stdio here.
 */

export function isLikelyPinoJsonLogLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(t) as { level?: unknown };
    return typeof parsed.level === 'number';
  } catch {
    return false;
  }
}

export type TuiStdioFilterHandle = {
  restore: () => void;
  /** Restore native stdio writes temporarily (e.g. inherited child process). */
  pause: () => void;
  /** Re-apply filtering after `pause()`. */
  resume: () => void;
};

/** Patch process stdout/stderr; call `restore()` before exiting the TUI. */
export function installTuiStdioFilter(): TuiStdioFilterHandle {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let suppressLogs = true;

  const stdoutBuf = { s: '' };
  const stderrBuf = { s: '' };

  const takeEmitCompleteLines = (buf: { s: string }): string => {
    let emit = '';
    while (true) {
      const idx = buf.s.indexOf('\n');
      if (idx === -1) break;
      const line = buf.s.slice(0, idx);
      buf.s = buf.s.slice(idx + 1);
      if (!isLikelyPinoJsonLogLine(line)) {
        emit += `${line}\n`;
      }
    }
    return emit;
  };

  const installBufferedLogFilter = (
    original: typeof process.stdout.write,
    buf: { s: string },
  ): typeof process.stdout.write =>
    function filteredWrite(chunk: unknown, ...rest: unknown[]): boolean {
      if (!suppressLogs) {
        const extra = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString() : '';
        const combined = buf.s ? buf.s + extra : extra;
        buf.s = '';
        return combined.length > 0
          ? ((original as Function)(combined, ...rest) as boolean)
          : true;
      }
      const text = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString() : '';
      if (text.includes('\x1b')) {
        let emit = takeEmitCompleteLines(buf);
        if (buf.s.length > 0) {
          const tail = buf.s.trimStart();
          if (!tail.startsWith('{')) {
            emit += buf.s;
            buf.s = '';
          }
        }
        if (emit.length > 0) {
          (original as Function)(emit, ...rest);
        }
        return (original as Function)(text, ...rest) as boolean;
      }
      buf.s += text;
      const emit = takeEmitCompleteLines(buf);
      return emit.length > 0 ? ((original as Function)(emit, ...rest) as boolean) : true;
    } as typeof process.stdout.write;

  const patch = () => {
    process.stdout.write = installBufferedLogFilter(originalStdoutWrite, stdoutBuf);
    process.stderr.write = installBufferedLogFilter(originalStderrWrite, stderrBuf);
  };

  const flushRemainder = (buf: { s: string }, orig: typeof process.stdout.write): void => {
    const rest = buf.s.trimEnd();
    buf.s = '';
    if (!rest.length) return;
    if (!isLikelyPinoJsonLogLine(rest)) {
      orig(`${rest}\n`);
    }
  };

  const unpatch = () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  };

  patch();

  return {
    restore: () => {
      suppressLogs = false;
      flushRemainder(stdoutBuf, originalStdoutWrite);
      flushRemainder(stderrBuf, originalStderrWrite);
      unpatch();
    },
    pause: () => {
      suppressLogs = false;
      flushRemainder(stdoutBuf, originalStdoutWrite);
      flushRemainder(stderrBuf, originalStderrWrite);
      unpatch();
    },
    resume: () => {
      suppressLogs = true;
      patch();
    },
  };
}
