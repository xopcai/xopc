import type { TuiBackend } from './tui-backend.js';

/** Attach explicitly to a running PTY; Ctrl+] detaches without killing it. */
export async function attachTuiTerminal(client: TuiBackend, conversationId: string, id: string): Promise<void> {
  const initial = await client.getJob(conversationId, id);
  if (!initial.tty || initial.status !== 'running') throw new Error('Attach requires a running job created with tty:true.');
  let offset = (initial.outputLength ?? initial.aggregatedOutput.length) - initial.aggregatedOutput.length;
  let cols = 0, rows = 0, detached = false;
  let failure: unknown;
  let inputQueue = Promise.resolve();
  const input = (chunk: Buffer) => {
    const text = chunk.toString();
    const escape = text.indexOf('\x1d');
    const chars = escape < 0 ? text : text.slice(0, escape);
    if (escape >= 0) detached = true;
    if (chars) inputQueue = inputQueue.then(() => client.writeJob(conversationId, id, chars)).catch(error => { failure = error; detached = true; });
  };
  const raw = process.stdin.isRaw;
  const paused = process.stdin.isPaused();
  process.stdin.setRawMode?.(true);
  process.stdin.on('data', input);
  process.stdin.resume();
  process.stdout.write('\x1b[2J\x1b[HAttached terminal · Ctrl+] detach\r\n');
  try {
    while (!detached) {
      if (cols !== process.stdout.columns || rows !== process.stdout.rows) {
        cols = process.stdout.columns || 100; rows = process.stdout.rows || 30;
        await client.resizeJob(conversationId, id, cols, rows);
      }
      const job = await client.getJob(conversationId, id);
      const end = job.outputLength ?? job.aggregatedOutput.length;
      const start = end - job.aggregatedOutput.length;
      if (offset < start) process.stdout.write('\r\n[Earlier terminal output was truncated]\r\n');
      if (offset < end) process.stdout.write(job.aggregatedOutput.slice(Math.max(0, offset - start)));
      offset = end;
      if (job.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await inputQueue;
    if (failure) throw failure;
  } finally {
    process.stdin.off('data', input);
    if (paused) process.stdin.pause();
    process.stdin.setRawMode?.(raw ?? false);
    process.stdout.write('\x1b[0m\x1b[?25h\r\nDetached terminal\r\n');
  }
}
