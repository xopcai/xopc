import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalVoiceRuntimeClient } from '../runtime-client.js';

const workerEntry = fileURLToPath(new URL('./fixtures/runtime-worker.mjs', import.meta.url));
const previousEntry = process.env.XOPC_VOICE_RUNTIME_ENTRY;
let client: LocalVoiceRuntimeClient | undefined;

describe.sequential('LocalVoiceRuntimeClient scheduling', () => {
  afterEach(() => {
    client?.stop();
    client = undefined;
    if (previousEntry === undefined) delete process.env.XOPC_VOICE_RUNTIME_ENTRY;
    else process.env.XOPC_VOICE_RUNTIME_ENTRY = previousEntry;
  });

  it('serializes model work while allowing health probes through', async () => {
    process.env.XOPC_VOICE_RUNTIME_ENTRY = workerEntry;
    client = new LocalVoiceRuntimeClient();

    const slow = client.request<{ completedAt: number }>('transcribe', { delayMs: 80 });
    const queued = client.request<{ completedAt: number }>('transcribe', { delayMs: 0 });
    const health = await client.request<{ method: string; completedAt: number }>('health');
    const first = await slow;
    const second = await queued;

    expect(health.method).toBe('health');
    expect(health.completedAt).toBeLessThan(first.completedAt);
    expect(second.completedAt).toBeGreaterThanOrEqual(first.completedAt);
  });

  it('does not start a queued request after its signal is cancelled', async () => {
    process.env.XOPC_VOICE_RUNTIME_ENTRY = workerEntry;
    client = new LocalVoiceRuntimeClient();
    const first = client.request('transcribe', { delayMs: 60 });
    const controller = new AbortController();
    const queued = client.request('transcribe', {}, { signal: controller.signal });
    controller.abort();

    await expect(queued).rejects.toThrow('aborted');
    await first;
  });
});
