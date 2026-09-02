import {
  ENDPOINT_PROTOCOL_VERSION,
  ENDPOINT_TEXT_OUTPUT_SCHEMA,
  type ClientEndpointMessage,
  type EndpointToolDescriptor,
} from '@xopcai/endpoint-tools-protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  EndpointToolHostController,
  EndpointToolRegistry,
  endpointToolRevision,
  type EndpointToolExecutionContext,
  type EndpointToolExecutionResult,
} from './index.js';

const descriptor: EndpointToolDescriptor = {
  name: 'mobile.test.echo',
  title: 'Echo',
  description: 'Echo text.',
  inputSchema: { type: 'object' },
  outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
  policyId: 'public.background-read',
  sensitivity: 'public',
  effect: 'read',
  confirmation: 'never',
  requiresForeground: false,
  requiredPermissions: [],
  timeoutMs: 10_000,
  maxConcurrency: 1,
  supportsCancellation: true,
  idempotent: true,
  resultKinds: ['text'],
};

function invocation(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: ENDPOINT_PROTOCOL_VERSION,
    messageId: crypto.randomUUID(),
    type: 'tool.invoke' as const,
    sentAt: Date.now(),
    payload: {
      invocationId: crypto.randomUUID(),
      toolCallId: 'call-1',
      toolName: descriptor.name,
      arguments: { text: 'hello' },
      descriptorRevision: endpointToolRevision(descriptor),
      confirmationRequired: false,
      deadlineAt: Date.now() + 10_000,
      ...overrides,
    },
  };
}

function createHost(options: {
  tool?: EndpointToolDescriptor;
  execute?: (
    args: Record<string, unknown>,
    context: EndpointToolExecutionContext,
  ) => Promise<EndpointToolExecutionResult>;
  availability?: 'foreground' | 'background';
  confirm?: ConstructorParameters<typeof EndpointToolHostController>[0]['confirm'];
} = {}) {
  const tool = options.tool ?? descriptor;
  const sent: ClientEndpointMessage[] = [];
  const execute = options.execute ?? (async (args: Record<string, unknown>) => ({
    content: [{ type: 'text' as const, text: String(args.text) }],
  }));
  const registry = new EndpointToolRegistry([{ descriptor: tool, execute }]);
  const host = new EndpointToolHostController({
    registry,
    getAvailability: () => options.availability ?? 'foreground',
    confirm: options.confirm ?? vi.fn(async () => true),
    uploadFile: vi.fn(),
    createMessageId: () => crypto.randomUUID(),
  });
  host.connect((message) => sent.push(message));
  return { execute, host, sent };
}

describe('EndpointToolHostController', () => {
  it('executes registered tools and returns validated content', async () => {
    const { host, sent } = createHost();

    await host.handleMessage(invocation());

    expect(sent.map((message) => message.type)).toEqual(['tool.received', 'tool.result']);
    expect(sent[1]).toMatchObject({ payload: { content: [{ type: 'text', text: 'hello' }] } });
  });

  it('aborts an active invocation when the gateway cancels it', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const { host, sent } = createHost({
      execute: async (_args, context) => {
        await waiting;
        expect(context.signal.aborted).toBe(true);
        return { content: [{ type: 'text', text: 'late' }] };
      },
    });
    const request = invocation();
    const running = host.handleMessage(request);
    await vi.waitFor(() => expect(sent[0]?.type).toBe('tool.received'));

    await host.handleMessage({
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type: 'tool.cancel',
      sentAt: Date.now(),
      payload: { invocationId: request.payload.invocationId, reason: 'stop' },
    });
    release();
    await running;

    expect(sent.map((message) => message.type)).toEqual(['tool.received', 'tool.cancelled']);
  });

  it('enforces deadline, foreground, and confirmation policy locally', async () => {
    const protectedTool = { ...descriptor, confirmation: 'always' as const, requiresForeground: true };
    const expired = createHost({ tool: protectedTool });
    await expired.host.handleMessage(invocation({
      toolName: protectedTool.name,
      descriptorRevision: endpointToolRevision(protectedTool),
      confirmationRequired: true,
      deadlineAt: Date.now() - 1,
    }));
    expect(expired.sent.at(-1)).toMatchObject({ type: 'tool.error', payload: { code: 'TOOL_TIMEOUT' } });

    const background = createHost({ tool: protectedTool, availability: 'background' });
    await background.host.handleMessage(invocation({
      toolName: protectedTool.name,
      descriptorRevision: endpointToolRevision(protectedTool),
      confirmationRequired: true,
    }));
    expect(background.sent.at(-1)).toMatchObject({
      type: 'tool.error', payload: { code: 'ENDPOINT_NOT_FOREGROUND' },
    });

    const mismatch = createHost({ tool: protectedTool });
    await mismatch.host.handleMessage(invocation({
      toolName: protectedTool.name,
      descriptorRevision: endpointToolRevision(protectedTool),
      confirmationRequired: false,
    }));
    expect(mismatch.sent.at(-1)).toMatchObject({ type: 'tool.error', payload: { code: 'PROTOCOL_ERROR' } });
  });

  it('rejects duplicate tool names', () => {
    const definition = { descriptor, execute: vi.fn() };
    expect(() => new EndpointToolRegistry([definition, definition])).toThrow('Duplicate endpoint tool');
  });
});
