import { CodemodeSandbox } from '@earendil-works/pi-codemode';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';

let workerUrl: URL | undefined;
function computerWorkerUrl(): URL {
  if (workerUrl) return workerUrl;
  // Electron already ships pi's self-contained worker beside its server bundle.
  const bundled = new URL('./codemode-worker.js', import.meta.url);
  const source = existsSync(bundled) ? bundled
    : new URL('./bundle/chunks/codemode-worker.js', import.meta.resolve('@earendil-works/pi-coding-agent'));
  workerUrl = new URL(`data:text/javascript;base64,${readFileSync(source).toString('base64')}`);
  return workerUrl;
}

export type ComputerProgramMethod = 'observe' | 'resolve' | 'act' | 'waitFor' | 'verify' | 'emitScreenshot';
export type ComputerProgramHost = (method: ComputerProgramMethod, args: unknown, signal: AbortSignal) => Promise<unknown>;

/** UI-only capability table; no general tool discovery, disk store, or output spill. */
export async function executeComputerProgram(code: string, host: ComputerProgramHost,
  store: Record<string, unknown>, signal: AbortSignal, timeoutMs = 120_000) {
  if (Buffer.byteLength(code) > 64 * 1024) throw new Error('COMPUTER_INPUT_LIMIT');
  let busy = false;
  let calls = 0;
  let ended = false;
  let hostErrorCode: string | undefined;
  let cancelledHostCall = false;
  const lifetime = new AbortController();
  const combined = AbortSignal.any([signal, lifetime.signal]);
  const inFlight = new Set<Promise<unknown>>();
  const sandbox = new CodemodeSandbox({ timeoutMs, memoryLimitBytes: 64 * 1024 * 1024, workerUrl: computerWorkerUrl(),
    globals: (['observe', 'resolve', 'act', 'waitFor', 'verify', 'emitScreenshot'] as const).map(method => ({
      name: `ui.${method}`,
      async execute(args, context) {
        if (ended || ++calls > 64) { lifetime.abort(); throw new Error('COMPUTER_PROGRAM_BUDGET'); }
        if (busy) { lifetime.abort(); throw new Error('COMPUTER_BUSY'); }
        busy = true;
        const operation = host(method, args, AbortSignal.any([combined, context.signal]));
        inFlight.add(operation);
        try { return await operation; }
        catch (error) {
          if (error instanceof Error && /^COMPUTER_[A-Z_0-9]{1,80}$/.test(error.message)) hostErrorCode = error.message;
          lifetime.abort(); throw error;
        }
        finally {
          cancelledHostCall ||= context.signal.aborted || combined.aborted;
          inFlight.delete(operation); busy = false;
        }
      },
    })) });
  try {
    const result = await sandbox.execute(code, { store, signal: combined });
    const unawaited = inFlight.size > 0;
    ended = true;
    lifetime.abort();
    await Promise.allSettled([...inFlight]);
    const text = result.output.filter(item => item.type === 'text').map(item => item.text).join('\n').slice(0, 16_000);
    if (unawaited || cancelledHostCall || hostErrorCode) return { status: 'program_error' as const, output: text,
      errorCode: hostErrorCode ?? 'COMPUTER_PROGRAM_UNAWAITED_CALL', scriptError: 'aborted' };
    if (result.ok === false) return { status: 'program_error' as const, output: text,
      errorCode: hostErrorCode ?? 'COMPUTER_PROGRAM_FAILED', scriptError: result.error.kind,
      scriptErrorMessage: result.error.message.slice(0, 1000) };
    const next: Record<string, unknown> = { ...store };
    for (const key of result.storeWrites.delete) delete next[key];
    Object.assign(next, result.storeWrites.set);
    if (Object.keys(next).length > 64 || Buffer.byteLength(JSON.stringify(next)) > 64 * 1024) throw new Error('COMPUTER_PROGRAM_STORE_LIMIT');
    // JSON state stays in this UI session; snapshots are independently checked on every use.
    z.record(z.string(), z.json()).parse(next);
    for (const key of Object.keys(store)) delete store[key];
    Object.assign(store, next);
    return { status: 'program_completed' as const, output: text };
  } finally {
    ended = true; lifetime.abort();
    await sandbox.close();
    await Promise.allSettled([...inFlight]);
  }
}
