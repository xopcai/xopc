// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Transport } from '../../../../../packages/extension-ui-sdk/src/transport';

afterEach(() => vi.useRealTimers());
describe('Local App delegation transport deadline', () => {
  it('waits beyond the host deadline for delegation while preserving the ordinary request deadline', async () => {
    vi.useFakeTimers();
    const transport = new Transport();
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'xopc-host', type: 'init', extensionId: 'app' } }));
    const ordinary = expect(transport.request('capability.describe', { id: 'xopc.notes.get' })).rejects.toThrow('10000ms');
    let settled = false;
    const delegated = transport.request('capability.call', { id: 'xopc.agent.delegate', call: {} });
    void delegated.catch(() => { settled = true; });
    const rejection = expect(delegated).rejects.toThrow('35000ms');
    await vi.advanceTimersByTimeAsync(10001); await ordinary; expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(24999); await rejection;
    transport.dispose();
  });
  it('honors an explicit SDK timeout override', async () => {
    vi.useFakeTimers();
    const transport = new Transport({ timeout: 50 });
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'xopc-host', type: 'init', extensionId: 'app' } }));
    const request = expect(transport.request('capability.call', { id: 'xopc.agent.delegate', call: {} })).rejects.toThrow('50ms');
    await vi.advanceTimersByTimeAsync(50); await request; transport.dispose();
  });
});
