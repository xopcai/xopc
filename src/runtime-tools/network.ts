import { fetch, ProxyAgent, type RequestInit, type Response } from 'undici';

const PROXY_AGENTS = new Map<string, ProxyAgent>();

function dispatcher(proxy?: string): ProxyAgent | undefined {
  if (!proxy) return undefined;
  const existing = PROXY_AGENTS.get(proxy);
  if (existing) return existing;
  const created = new ProxyAgent(proxy);
  PROXY_AGENTS.set(proxy, created);
  return created;
}

export async function fetchRuntimeResource(params: {
  url: string;
  timeoutMs: number;
  proxy?: string;
  signal?: AbortSignal;
  init?: Omit<RequestInit, 'dispatcher' | 'signal'>;
}) {
  const timeoutSignal = AbortSignal.timeout(params.timeoutMs);
  const signal = params.signal
    ? AbortSignal.any([params.signal, timeoutSignal])
    : timeoutSignal;
  return await fetch(params.url, {
    ...params.init,
    dispatcher: dispatcher(params.proxy),
    signal,
  });
}

export async function readRuntimeResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Response exceeds size limit');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
}
