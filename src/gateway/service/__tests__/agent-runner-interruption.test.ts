import { describe, expect, it, vi } from 'vitest';

import type { RunGatewayAgentDeps } from '../run-gateway-agent.js';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../run-gateway-agent.js', () => ({ runGatewayAgent: mocks.run }));

import { GatewayAgentRunner } from '../agent-runner.js';

describe('GatewayAgentRunner interrupted consumption', () => {
  it('awaits inner cleanup and releases the active session when the consumer stops early', async () => {
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => { release = resolve; });
    let cleaning = false;
    const key = 'agent:main:webchat:default:direct:voice';
    mocks.run.mockImplementation(async function* (deps: RunGatewayAgentDeps) {
      deps.activeWebchatRunBySession.set(key, 'run');
      try {
        yield { type: 'assistant_delta', payload: { delta: 'Hello.' } };
        yield { type: 'assistant_delta', payload: { delta: 'Late.' } };
      } finally {
        cleaning = true;
        await cleanup;
        deps.activeWebchatRunBySession.delete(key);
      }
      return { status: 'ok', summary: '' };
    });
    const runner = new GatewayAgentRunner({ getConfig: () => ({}), getAgentService: () => ({}) } as never);
    const stream = runner.runAgent('hello', 'webchat', key, { type: 'channel', channel: 'webchat' });
    await stream.next();
    expect(runner.hasActiveRun(key)).toBe(true);
    let stopped = false;
    const stopping = stream.return({ status: 'aborted', summary: '' }).then(() => { stopped = true; });
    try {
      await vi.waitFor(() => expect(cleaning).toBe(true));
      expect(stopped).toBe(false);
    } finally { release(); }
    await stopping;
    expect(runner.hasActiveRun(key)).toBe(false);
  });
});
