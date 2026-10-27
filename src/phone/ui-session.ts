import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAdb } from './adb-command.js';
import { PhoneError, type PhoneElement } from './contracts.js';
import { measurePhonePhase } from './execution-trace.js';
import { PHONE_UI_DEX } from './ui-dump-binary.js';

export interface PhoneUiTransport {
  readable: AsyncIterable<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** One request in flight, bounded framing, no replay after transport or confirmation failure. */
export class PhoneUiSession {
  private sequence = 0;
  private busy = false;
  private closed = false;
  private closing?: Promise<void>;
  private buffer = '';
  private iterator: AsyncIterator<Uint8Array>;
  constructor(private transport: PhoneUiTransport) { this.iterator = transport.readable[Symbol.asyncIterator](); }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.buffer = '';
    this.closing = this.transport.close();
    return this.closing;
  }
  private async request(fields: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (this.closed || this.busy) throw new PhoneError('PHONE_UI_UNAVAILABLE', 'Phone observer is closed or busy', 409);
    const combined = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    combined.throwIfAborted(); this.busy = true;
    const id = ++this.sequence;
    let reason = '';
    let abort: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => { void this.close().catch(() => {}); reject(new PhoneError('PHONE_UI_UNAVAILABLE', 'Phone observer stopped or timed out', 409)); };
      combined.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([cancelled, (async () => {
        await this.transport.write(Buffer.from(`${JSON.stringify({ ...fields, id })}\n`));
        const decoder = new TextDecoder('utf-8', { fatal: true });
        while (!this.buffer.includes('\n')) {
          const next = await this.iterator.next();
          if (next.done || this.closed) throw new Error('Observer disconnected');
          this.buffer += decoder.decode(next.value, { stream: true });
          if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) throw new Error('Observer response exceeded limit');
        }
        const end = this.buffer.indexOf('\n');
        const response = JSON.parse(this.buffer.slice(0, end)); this.buffer = this.buffer.slice(end + 1);
        if (response.id !== id || response.ok !== true) {
          if (['no-root', 'app', 'focus', 'target', 'value', 'write', 'identity', 'confirmation'].includes(response.error)) reason = ` (${response.error})`;
          throw new Error('Observer request unconfirmed');
        }
        return response;
      })()]);
    } catch {
      await this.close().catch(() => {});
      throw new PhoneError(fields.op === 'setText' ? 'PHONE_TEXT_INPUT_UNCONFIRMED' : 'PHONE_UI_UNAVAILABLE',
        fields.op === 'setText' ? `Field input could not be confirmed${reason}. Inspect the field before retrying.` : 'Phone observation failed; reconnect before controlling the phone', 409);
    } finally { this.busy = false; combined.removeEventListener('abort', abort!); }
  }
  async snapshot(signal: AbortSignal): Promise<string> {
    const response = await this.request({ op: 'snapshot' }, signal);
    if (typeof response.xml !== 'string' || !response.xml.includes('</hierarchy>')) {
      await this.close(); throw new PhoneError('PHONE_UI_UNAVAILABLE', 'Incomplete phone observation', 409);
    }
    return response.xml;
  }
  async replace(app: string, target: PhoneElement, text: string, signal: AbortSignal): Promise<void> {
    await measurePhonePhase('field_transaction', () => this.request({ op: 'setText', app, resourceId: target.resourceId,
      bounds: target.bounds.join(','), before: target.text, text }, signal));
  }
}

export async function openLocalPhoneUi(adbPath: string, serial: string, signal: AbortSignal): Promise<PhoneUiSession> {
  const binary = Buffer.from(PHONE_UI_DEX, 'base64');
  const hash = createHash('sha256').update(binary).digest('hex');
  const remote = `/data/local/tmp/xopc-ui-${hash}.dex`;
  const args = ['-s', serial];
  const existing = await runAdb(adbPath, [...args, 'shell', 'sha256sum', remote], signal).catch(() => Buffer.alloc(0));
  signal.throwIfAborted();
  if (existing.toString().trim().split(/\s+/)[0] !== hash) {
    const work = await mkdtemp(join(tmpdir(), 'xopc-ui-'));
    const staging = `${remote}.${randomUUID()}.tmp`;
    try {
      await writeFile(join(work, 'helper.dex'), binary, { mode: 0o600 });
      await runAdb(adbPath, [...args, 'push', join(work, 'helper.dex'), staging], signal);
      await runAdb(adbPath, [...args, 'shell', 'chmod', '400', staging], signal);
      await runAdb(adbPath, [...args, 'shell', 'mv', '-f', staging, remote], signal);
      const verified = await runAdb(adbPath, [...args, 'shell', 'sha256sum', remote], signal);
      if (verified.toString().trim().split(/\s+/)[0] !== hash) throw new PhoneError('PHONE_UI_UNAVAILABLE', 'Observer verification failed');
    } finally { await rm(work, { recursive: true, force: true }); await runAdb(adbPath, [...args, 'shell', 'rm', '-f', staging], undefined, 3000).catch(() => {}); }
  }
  signal.throwIfAborted();
  const child = spawn(adbPath, [...args, 'shell', '-T', 'env', `CLASSPATH=${remote}`, 'app_process', '/', 'ai.xopc.phone.PhoneUiDump', '--resident'], { stdio: ['pipe', 'pipe', 'ignore'] });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  return new PhoneUiSession({ readable: child.stdout,
    write: data => new Promise((resolve, reject) => child.stdin.write(data, error => error ? reject(error) : resolve())),
    close: async () => {
      child.stdin.destroy(); child.stdout.destroy();
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>(resolve => { child.once('close', resolve); child.kill(); });
    },
  });
}
