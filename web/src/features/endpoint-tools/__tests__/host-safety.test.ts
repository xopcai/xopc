import type {
  EndpointToolDescriptor,
  ServerEndpointMessage,
} from '@xopcai/endpoint-tools-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settleEndpointConfirmation } from '../confirmation-store';
import { EndpointToolHost } from '../host';

const descriptor: EndpointToolDescriptor = {
  name: 'web.clipboard.write',
  title: 'Write clipboard',
  description: 'Write clipboard text.',
  inputSchema: { type: 'object' },
  effect: 'write',
  confirmation: 'always',
  requiresForeground: true,
  requiredPermissions: ['clipboard-write'],
  timeoutMs: 10_000,
  maxConcurrency: 1,
  supportsCancellation: false,
  idempotent: true,
  resultKinds: ['text'],
};

function invokeMessage(invocationId: string, deadlineAt: number, confirmationRequired = true): Extract<
  ServerEndpointMessage,
  { type: 'tool.invoke' }
> {
  return {
    protocolVersion: 1,
    messageId: crypto.randomUUID(),
    type: 'tool.invoke',
    sentAt: Date.now(),
    payload: {
      invocationId,
      toolCallId: 'tool-call-1',
      toolName: descriptor.name,
      arguments: { text: 'hello' },
      descriptorRevision: 'revision-1',
      confirmationRequired,
      deadlineAt,
    },
  };
}

function fixture(focused = true) {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    send: (value: string) => sent.push(value),
  } as unknown as WebSocket;
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'done' }] }));
  const host = new EndpointToolHost({
    kind: 'web', platform: 'web', displayName: 'Browser', appVersion: '1',
    tools: [descriptor], execute, confirmReenrollment: async () => false,
  });
  const internal = host as unknown as {
    socket: WebSocket;
    revisionByTool: Map<string, string>;
    cancelled: Set<string>;
    invoke(message: Extract<ServerEndpointMessage, { type: 'tool.invoke' }>, socket: WebSocket): Promise<void>;
  };
  internal.socket = socket;
  internal.revisionByTool.set(descriptor.name, 'revision-1');
  vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => focused });
  return { execute, host: internal, sent, socket };
}

describe('EndpointToolHost execution guards', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('WebSocket', { OPEN: 1 });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not execute an expired invocation', async () => {
    const { execute, host, socket } = fixture();
    await host.invoke(invokeMessage('expired', Date.now() - 1), socket);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects attempts to suppress the local confirmation policy', async () => {
    const { execute, host, sent, socket } = fixture();
    await host.invoke(invokeMessage('no-confirmation', Date.now() + 10_000, false), socket);
    expect(execute).not.toHaveBeenCalled();
    expect(sent.some((value) => {
      const message = JSON.parse(value) as { type: string; payload?: { code?: string } };
      return message.type === 'tool.error' && message.payload?.code === 'PROTOCOL_ERROR';
    })).toBe(true);
  });

  it('rechecks foreground state locally', async () => {
    const { execute, host, socket } = fixture(false);
    await host.invoke(invokeMessage('background', Date.now() + 10_000), socket);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not execute when cancellation arrives during confirmation', async () => {
    const { execute, host, socket } = fixture();
    const invocation = host.invoke(invokeMessage('cancelled', Date.now() + 10_000), socket);
    await Promise.resolve();
    host.cancelled.add('cancelled');
    settleEndpointConfirmation('cancelled', false);
    await invocation;
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not report success when cancellation arrives during execution', async () => {
    let finishExecution: (() => void) | undefined;
    const { execute, host, sent, socket } = fixture();
    execute.mockImplementation(() => new Promise((resolve) => {
      finishExecution = () => resolve({ content: [{ type: 'text', text: 'done' }] });
    }));
    const invocation = host.invoke(invokeMessage('cancelled-running', Date.now() + 10_000), socket);
    await Promise.resolve();
    settleEndpointConfirmation('cancelled-running', true);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    host.cancelled.add('cancelled-running');
    finishExecution?.();
    await invocation;

    const messageTypes = sent.map((value) => JSON.parse(value) as { type: string }).map(({ type }) => type);
    expect(messageTypes).toContain('tool.cancelled');
    expect(messageTypes).not.toContain('tool.result');
  });
});
