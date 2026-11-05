import {
  ENDPOINT_PROTOCOL_VERSION,
  ENDPOINT_TEXT_OUTPUT_SCHEMA,
  providerEndpointDescriptor,
  type ProviderTool,
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
  authorize?: ConstructorParameters<typeof EndpointToolHostController>[0]['authorize'];
  confirm?: ConstructorParameters<typeof EndpointToolHostController>[0]['confirm'];
  sendMessage?: (message: ClientEndpointMessage, sent: ClientEndpointMessage[]) => void;
} = {}) {
  const tool = options.tool ?? descriptor;
  const sent: ClientEndpointMessage[] = [];
  const execute = vi.fn(options.execute ?? (async (args: Record<string, unknown>) => ({
    content: [{ type: 'text' as const, text: String(args.text) }],
  })));
  const registry = new EndpointToolRegistry([{ descriptor: tool, execute }]);
  const host = new EndpointToolHostController({
    registry,
    getAvailability: () => options.availability ?? 'foreground',
    authorize: options.authorize,
    confirm: options.confirm ?? vi.fn(async () => true),
    uploadFile: vi.fn(),
    createMessageId: () => crypto.randomUUID(),
  });
  host.connect((message) => {
    if (options.sendMessage) options.sendMessage(message, sent);
    else sent.push(message);
  });
  return { execute, host, sent };
}

describe('EndpointToolHostController', () => {
  it('serializes different Provider tools sharing one local resource while independent reads continue', async () => {
    const base = { title: 'Resource', description: 'Read device resource', inputSchema: { type: 'object' },
      effect: 'read', sensitivity: 'public', confirmation: 'never', requiresForeground: false, requiredPermissions: [],
      timeoutMs: 10_000, maxConcurrency: 1, supportsCancellation: false, idempotent: true, resultKinds: ['text'] } satisfies Omit<ProviderTool, 'name'>;
    const tools = [{ ...base, name: 'first', resourceId: 'camera' }, { ...base, name: 'second', resourceId: 'camera' },
      { ...base, name: 'independent', resourceId: 'reader' }];
    const registry = new EndpointToolRegistry([]);
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const result = { content: [{ type: 'text' as const, text: 'done' }] };
    const first = vi.fn(async () => { await waiting; return result; });
    const second = vi.fn(async () => result), independent = vi.fn(async () => result);
    registry.registerProvider({ localId: 'fixture', title: 'Fixture', summary: 'Device resources',
      tools: tools.map((tool, index) => ({ descriptor: tool, execute: [first, second, independent][index] })) });
    const sent: ClientEndpointMessage[] = [];
    const host = new EndpointToolHostController({ registry, getAvailability: () => 'foreground', confirm: async () => true,
      uploadFile: vi.fn(), createMessageId: () => crypto.randomUUID() });
    host.connect(message => sent.push(message));
    await host.handleMessage({ type: 'provider.catalog.ack', protocolVersion: ENDPOINT_PROTOCOL_VERSION, messageId: crypto.randomUUID(),
      sentAt: Date.now(), payload: { accepted: true, revision: registry.providerRevision() } });
    const call = (tool: ProviderTool) => {
      const descriptor = providerEndpointDescriptor('fixture', tool);
      return host.handleMessage(invocation({ toolName: descriptor.name, descriptorRevision: endpointToolRevision(descriptor) }));
    };
    const running = call(tools[0]);
    try {
      await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());
      await call(tools[1]);
      expect(sent.at(-1)).toMatchObject({ type: 'tool.error', payload: { code: 'TOOL_BUSY' } });
      expect(second).not.toHaveBeenCalled();
      await call(tools[2]);
      expect(independent).toHaveBeenCalledOnce();
      finish(); await running;
      await call(tools[1]);
      expect(second).toHaveBeenCalledOnce();
    } finally { finish(); await running; host.disconnect(); }
  });
  it('publishes readiness only for the acknowledged catalog revision, including after reconnect', async () => {
    const registry = new EndpointToolRegistry([]);
    registry.registerProvider({ localId: 'fixture', title: 'Fixture', summary: 'Fixture capabilities', tools: [] });
    const sent: ClientEndpointMessage[] = [];
    const host = new EndpointToolHostController({ registry, getAvailability: () => 'foreground',
      confirm: async () => false, uploadFile: vi.fn(), createMessageId: () => crypto.randomUUID() });
    const connect = () => host.connect(message => sent.push(message));
    const ack = (revision: number, accepted: boolean) => host.handleMessage({
      type: 'provider.catalog.ack', protocolVersion: ENDPOINT_PROTOCOL_VERSION, sentAt: Date.now(), messageId: crypto.randomUUID(),
      payload: accepted ? { revision, accepted } : { revision, accepted, code: 'PROVIDER_CATALOG_REJECTED' },
    });
    try {
      connect();
      const revision = registry.providerRevision();
      expect(sent.map(message => message.type)).toEqual(['provider.catalog.replace']);
      await ack(revision - 1, true);
      await ack(revision, false);
      expect(sent).toHaveLength(1);
      await ack(revision, true);
      expect(sent.at(-1)).toMatchObject({ type: 'provider.state.changed', payload: { catalogRevision: revision } });
      connect();
      expect(sent.at(-1)).toMatchObject({ type: 'provider.catalog.replace', payload: { revision } });
      await ack(revision, true);
      expect(sent.at(-1)?.type).toBe('provider.state.changed');
    } finally { host.disconnect(); }
  });

  it('quarantines unsettled work across reconnect instead of admitting a concurrent execution', async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const { host, sent, execute } = createHost({ execute: async () => { await waiting; return { content: [{ type: 'text', text: 'done' }] }; } });
    const running = host.handleMessage(invocation());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    host.disconnect(); host.connect(message => sent.push(message));
    await host.handleMessage(invocation());
    expect(sent.at(-1)).toMatchObject({ type: 'tool.error', payload: { code: 'TOOL_BUSY' } });
    expect(execute).toHaveBeenCalledTimes(1);
    release(); await running;
    expect(sent.some(message => message.type === 'tool.result')).toBe(false);
    await host.handleMessage(invocation());
    expect(execute).toHaveBeenCalledTimes(2);
    host.disconnect();
  });

  it('rejects dedicated terminal controls without invoking a legacy tool', async () => {
    const { host, sent, execute } = createHost();
    await host.handleMessage({ protocolVersion: 3, messageId: crypto.randomUUID(), sentAt: Date.now(), type: 'terminal.command',
      payload: { invocationId: crypto.randomUUID(), command: { action: 'close', sessionId: crypto.randomUUID(), generation: crypto.randomUUID(), connectionInstanceId: crypto.randomUUID() } } });
    expect(execute).not.toHaveBeenCalled();
    expect(sent).toMatchObject([{ type: 'tool.error', payload: { code: 'PROTOCOL_ERROR' } }]);
  });
  it.each(['execution', 'operationQuery'])('refuses %s metadata instead of executing it through the legacy controller', async field => {
    const { host, sent, execute } = createHost();
    await host.handleMessage(invocation({ [field]: { operationId: crypto.randomUUID(), gatewayId: crypto.randomUUID(), deviceId: crypto.randomUUID(),
      tool: descriptor.name, argumentHash: 'a'.repeat(64), toolRevision: endpointToolRevision(descriptor), authorizationRevision: 1, expiresAt: Date.now() + 10000 } }));
    expect(execute).not.toHaveBeenCalled();
    expect(sent).toMatchObject([{ type: 'tool.error', payload: { code: 'PROTOCOL_ERROR' } }]);
  });
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
    expect(sent.map(message => message.type)).toEqual(['tool.received']);
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

  it('authorizes a system-mediated write without requesting another confirmation', async () => {
    const mediatedTool = {
      ...descriptor,
      policyId: 'user.foreground-mediated-write',
      sensitivity: 'personal' as const,
      effect: 'write' as const,
      confirmation: 'never' as const,
      requiresForeground: true,
      requiredPermissions: ['file-share'],
    };
    const authorize = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => true);
    const mediated = createHost({ tool: mediatedTool, authorize, confirm });

    await mediated.host.handleMessage(invocation({
      toolName: mediatedTool.name,
      descriptorRevision: endpointToolRevision(mediatedTool),
      confirmationRequired: false,
    }));

    expect(authorize).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(mediated.execute).toHaveBeenCalledOnce();
    expect(mediated.sent.map((message) => message.type)).toEqual(['tool.received', 'tool.result']);
  });

  it('does not execute when endpoint authorization is rejected', async () => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'no' }] }));
    const denied = createHost({
      execute,
      authorize: vi.fn(async () => {
        const error = new Error('Data sharing is not authorized');
        error.name = 'NotAllowedError';
        throw error;
      }),
    });

    await denied.host.handleMessage(invocation());

    expect(execute).not.toHaveBeenCalled();
    expect(denied.sent.at(-1)).toMatchObject({
      type: 'tool.error',
      payload: { code: 'PERMISSION_DENIED' },
    });
  });

  it('reports an oversized transport result without disconnecting the endpoint', async () => {
    const oversized = createHost({
      sendMessage: (message, sent) => {
        if (message.type === 'tool.result') {
          const error = new Error('Realtime client frame exceeds its limit');
          error.name = 'RealtimeFrameTooLargeError';
          throw error;
        }
        sent.push(message);
      },
    });

    await oversized.host.handleMessage(invocation());

    expect(oversized.sent.map((message) => message.type)).toEqual(['tool.received', 'tool.error']);
    expect(oversized.sent.at(-1)).toMatchObject({
      payload: { code: 'RESULT_TOO_LARGE' },
    });
  });

  it('rejects duplicate tool names', () => {
    const definition = { descriptor, execute: vi.fn() };
    expect(() => new EndpointToolRegistry([definition, definition])).toThrow('Duplicate endpoint tool');
  });
});
