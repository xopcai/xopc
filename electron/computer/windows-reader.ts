import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';

/** Private, serialized read-only worker; no cached target state or arbitrary commands. */
export class WindowsNativeReader {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: { resolve: (value: unknown) => void; reject: (error: Error) => void };
  private buffer = '';
  private queue = Promise.resolve();
  private idle?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(private readonly script: string) {}

  read(request: { pid: number; windowId?: string; includeInput: boolean }, signal?: AbortSignal): Promise<unknown> {
    const result = this.queue.then(() => this.request(request, signal));
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  private async request(request: object, signal?: AbortSignal): Promise<unknown> {
    if (this.disposed) throw new Error('COMPUTER_NATIVE_IDENTITY_UNAVAILABLE');
    signal?.throwIfAborted();
    clearTimeout(this.idle);
    if (!this.child) {
      const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(this.script, 'utf16le').toString('base64')],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (this.child !== child) return;
        this.buffer += chunk;
        if (Buffer.byteLength(this.buffer) > 64 * 1024) { this.close(); return; }
        const end = this.buffer.indexOf('\n');
        if (end < 0) return;
        const line = this.buffer.slice(0, end).replace(/^\uFEFF/, '').trim();
        this.buffer = this.buffer.slice(end + 1);
        const pending = this.pending;
        if (!pending || this.buffer.trim()) { this.close(); return; }
        this.pending = undefined;
        try { pending.resolve(JSON.parse(line)); }
        catch { pending.reject(new Error('COMPUTER_NATIVE_IDENTITY_UNAVAILABLE')); this.close(); }
      });
      child.stderr.resume();
      const died = () => { if (this.child === child) this.close(); };
      child.once('error', died); child.once('exit', died);
      child.stdin.on('error', died);
    }
    const abort = () => this.close();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 8000);
    try {
      signal?.throwIfAborted();
      return await new Promise((resolve, reject) => {
        this.pending = { resolve, reject };
        this.child!.stdin.write(JSON.stringify(request) + '\n');
      });
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (this.child) { this.idle = setTimeout(() => this.close(), 30000); this.idle.unref(); }
    }
  }

  close(): void {
    clearTimeout(this.idle);
    const child = this.child; this.child = undefined;
    const pending = this.pending; this.pending = undefined; this.buffer = '';
    pending?.reject(new Error('COMPUTER_NATIVE_IDENTITY_UNAVAILABLE'));
    child?.stdin.destroy(); child?.kill();
  }
  dispose(): void { this.disposed = true; this.close(); }
}
