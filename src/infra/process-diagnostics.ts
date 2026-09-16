import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { inspect } from 'node:util';

import { redactObject, redactSensitiveInfo } from '../utils/logger/redact.js';

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_DETAIL_CHARS = 64 * 1024;

function diagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[MaxDepth]';
  if (value instanceof Error) {
    return {
      name: value.name, message: value.message, stack: value.stack,
      ...(value.cause === undefined ? {} : { cause: diagnosticValue(value.cause, depth + 1) }),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => diagnosticValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 30)
      .map(([key, item]) => [key, diagnosticValue(item, depth + 1)]));
  }
  return value;
}

let activeWriter: ReturnType<typeof createProcessDiagnosticWriter> | undefined;

export function recordProcessDiagnostic(event: string, detail: unknown): void {
  activeWriter?.(event, detail);
}

/** Independent of SQLite and async logger transports; safe to use during process failure. */
export function createProcessDiagnosticWriter(path: string): (event: string, detail: unknown) => void {
  return (event, detail) => {
    try {
      const text = typeof detail === 'string' ? detail : inspect(redactObject(diagnosticValue(detail)), {
        depth: 5, maxArrayLength: 30, maxStringLength: MAX_DETAIL_CHARS, customInspect: false, getters: false,
      });
      const line = JSON.stringify({
        time: new Date().toISOString(), pid: process.pid, event,
        detail: redactSensitiveInfo(text).slice(-MAX_DETAIL_CHARS),
      }) + '\n';
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      let size = 0;
      try { size = statSync(path).size; } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      if (size + Buffer.byteLength(line) > MAX_LOG_BYTES) {
        rmSync(`${path}.2`, { force: true });
        try { renameSync(`${path}.1`, `${path}.2`); } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        renameSync(path, `${path}.1`);
      }
      appendFileSync(path, line, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Disk-full/permission errors must never turn diagnostics into another crash.
    }
  };
}

/** Observe fatal exceptions without resuming execution in an unknown process state. */
export function installProcessDiagnostics(path: string): () => void {
  const write = createProcessDiagnosticWriter(path);
  const previousWriter = activeWriter;
  activeWriter = write;
  const onFatal = (error: Error, origin: string) => write('uncaught_exception', { origin, error, uptimeSeconds: process.uptime(), memory: process.memoryUsage() });
  const onExit = (code: number) => write('process_exit', { code, uptimeSeconds: process.uptime() });
  process.on('uncaughtExceptionMonitor', onFatal);
  process.on('exit', onExit);
  write('process_start', { node: process.version, platform: process.platform, arch: process.arch });
  return () => {
    if (activeWriter === write) activeWriter = previousWriter;
    process.removeListener('uncaughtExceptionMonitor', onFatal);
    process.removeListener('exit', onExit);
  };
}
