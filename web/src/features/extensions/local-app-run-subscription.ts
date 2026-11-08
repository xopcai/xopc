import { apiFetch } from '@/lib/fetch';

/** Host-only SSE connection. Credentials, URLs and release identity never enter the iframe. */
export async function watchLocalAppRun(url: string, signal: AbortSignal, send: (data: unknown) => void): Promise<void> {
  let delay = 500;
  while (!signal.aborted) {
    try {
      const response = await apiFetch(url, { signal, headers: { Accept: 'text/event-stream' } });
      if (!response.ok || !response.body) {
        send({ type: 'error', message: 'Run subscription unavailable; review access before retrying' }); return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer = (buffer + chunk.value).replaceAll('\r\n', '\n');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            if (end > 131072) throw new Error('Run event exceeds its size limit');
            const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data || signal.aborted) continue;
            if (event.split('\n').some(line => line.trim() === 'event: ended')) {
              send({ type: 'error', message: 'Run authorization ended' }); return;
            }
            const snapshot = JSON.parse(data) as { run?: { status?: string } };
            send({ type: 'snapshot', ...snapshot }); delay = 500;
            if (snapshot.run?.status && !['queued', 'running', 'cancelling'].includes(snapshot.run.status)) return;
          }
          if (buffer.length > 131072) throw new Error('Run event exceeds its size limit');
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch { if (signal.aborted) return; }
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, delay); signal.addEventListener('abort', finish, { once: true });
    });
    delay = Math.min(delay * 2, 10000);
  }
}
