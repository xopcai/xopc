import { describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { subscribeEmbeddedSessionEvents } from '../subscribe-session.js';

describe('embedded runtime events', () => {
  it('forwards the actual tool and turn events with their original arguments', () => {
    let publish!: (event: any) => void;
    const session = { subscribe: (listener: typeof publish) => { publish = listener; return () => {}; } };
    const stream = vi.fn();
    const runtime = vi.fn();
    subscribeEmbeddedSessionEvents(session as unknown as AgentSession, stream, runtime);
    const events = [
      { type: 'turn_start' },
      { type: 'tool_execution_start', toolCallId: '1', toolName: 'exec_command', args: { cmd: 'pnpm test' } },
      { type: 'tool_execution_end', toolCallId: '1', toolName: 'exec_command', result: { content: [], details: { exitCode: 1 } }, isError: true },
      { type: 'turn_end', message: {}, toolResults: [] },
    ];
    events.forEach(publish);
    expect(runtime.mock.calls.map(([event]) => event)).toEqual(events);
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_execution_end', isError: true }));
  });

  it('emits the session end only after recovery has settled, including cancellation', () => {
    let publish!: (event: any) => void;
    const session = { subscribe: (listener: typeof publish) => { publish = listener; return () => {}; } };
    const stream = vi.fn();
    subscribeEmbeddedSessionEvents(session as unknown as AgentSession, stream);
    publish({ type: 'agent_end', messages: [], willRetry: true });
    publish({ type: 'agent_start' });
    publish({ type: 'agent_end', messages: [], willRetry: false });
    expect(stream.mock.calls.map(([event]) => event.type)).toEqual(['agent_start']);
    publish({ type: 'agent_settled', aborted: true });
    expect(stream).toHaveBeenLastCalledWith({ type: 'agent_end', aborted: true });
  });
});
