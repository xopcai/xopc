import { randomUUID } from 'node:crypto';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition, ToolInfo } from '@earendil-works/pi-coding-agent';
import {
  deviceStateDescriptor,
  locationDescriptor,
  PERSONAL_TOOL_NAMES,
  personalDescriptor,
  type EndpointHelloPayload,
  type EndpointToolDescriptor,
  type TurnOrigin,
} from '@xopcai/endpoint-tools-protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EndpointToolRuntime } from '../../../endpoint-tools/runtime.js';
import { setMobileCapabilityAllowed } from '../../../endpoint-tools/device-capability-grants.js';
import { recordDeviceExecutionActor } from '../../../endpoint-tools/execution-actor.js';
import { deviceTurnSourceContext } from '../../../endpoint-tools/turn-context.js';
import { personalInstructions } from '../../../personal-agent/prompts.js';
import { requireXopcDatabase } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { claimNextSessionInput, insertSessionInput } from '../../../storage/sqlite/session-input-repository.js';
import { EndpointToolProvider } from '../../external-tools/endpoint-provider.js';
import { createExternalToolGatewayTools } from '../../external-tools/gateway-tools.js';
import { getExternalToolRegistry } from '../../external-tools/tool-registry.js';
import type { ExternalDiscoveryResult } from '../../external-tools/discovery.js';
import { buildSystemPrompt } from '../../prompt/system-prompt.js';
import { runWithEmbeddedExecutionSession } from '../execution-context.js';
import { materializeNativeExternalTools } from '../external-tool-discovery.js';
import { deferredToolContract, getXopcToolMetadata } from '../tool-metadata.js';
import { createXopcToolSearchExtension } from '../tool-search-extension.js';
import { xopcToolsToDefinitions } from '../xopc-tools-bridge.js';

function mobileToolSet(): EndpointToolDescriptor[] {
  return [
    deviceStateDescriptor('mobile', 'state'),
    deviceStateDescriptor('mobile', 'power'),
    locationDescriptor('mobile'),
    ...PERSONAL_TOOL_NAMES.map(name => personalDescriptor(name)),
  ];
}

function registerEndpoint(
  runtime: EndpointToolRuntime,
  params: {
    principalId: string;
    endpointId: string;
    displayName: string;
    kind: 'mobile' | 'desktop';
    platform: string;
    availability?: 'foreground' | 'background';
    backgroundToolsSupported?: boolean;
    tools: EndpointToolDescriptor[];
  },
) {
  const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const hello: EndpointHelloPayload = {
    principalId: params.principalId,
    endpointId: params.endpointId,
    connectionInstanceId: randomUUID(),
    displayName: params.displayName,
    kind: params.kind,
    platform: params.platform,
    appVersion: '1.0.0',
    availability: params.availability ?? 'foreground',
    nonce: randomUUID(),
    signedAt: Date.now(),
    signature: 'eval-signature',
    tools: params.tools,
  };
  const connectionId = randomUUID();
  runtime.registry.register(
    hello,
    connectionId,
    {
      readyState: 1,
      send: data => sent.push(JSON.parse(data)),
      close: () => {},
    },
    Date.now(),
    undefined,
    false,
    params.backgroundToolsSupported ?? false,
  );
  return { connectionId, sent };
}

function createSearchHarness(tools: AgentTool[], externalResult?: ExternalDiscoveryResult) {
  const definitions = xopcToolsToDefinitions(tools);
  let active: string[] = [];
  const registry = getExternalToolRegistry(tools);
  const api = {
    registerTool: (definition: ToolDefinition) => {
      const index = definitions.findIndex(item => item.name === definition.name);
      if (index < 0) definitions.push(definition);
      else definitions[index] = definition;
    },
    getAllTools: () => definitions as unknown as ToolInfo[],
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => {
      active = [...new Set(names)].filter(name => definitions.some(item => item.name === name));
    },
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI;

  const stubRegistry = registry
    ? {
        ...registry,
        search: vi.fn(async () => externalResult ?? ({
          tools: [],
          connectionCandidates: [],
          installCandidates: [],
          unavailableSources: [],
          selectedConnections: [],
        } as ExternalDiscoveryResult)),
      }
    : undefined;

  createXopcToolSearchExtension(tools, { registry: stubRegistry })(api);
  const searchTool = definitions.find(item => item.name === 'tool_search')!;

  const runSearch = async (query: string, limit = 8) => {
    active = [];
    const result = await searchTool.execute(
      randomUUID(),
      { query, limit },
      new AbortController().signal,
      undefined,
      {} as ExtensionToolContext,
    );
    return JSON.parse((result.content[0] as { text: string }).text) as {
      loadedTools: Array<{ name: string; description: string }>;
      externalTools: Array<{ toolRef: string }>;
    };
  };

  return { runSearch, api };
}

function setupConversationWithActor(
  origin: TurnOrigin,
  principal: { kind: 'owner' | 'device'; principalId: string; deviceId?: string; scopes: readonly ('gateway.admin' | 'sessions.write')[] },
) {
  const conversationId = createConversation({
    agentId: 'main',
    routing: { agentId: 'main', source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' },
  }).key;
  const clientMessageId = `msg-${randomUUID()}`;
  const runId = randomUUID();
  insertSessionInput({
    id: randomUUID(),
    conversationId,
    clientMessageId,
    requestedDelivery: 'next',
    effectiveDelivery: 'next',
    status: 'queued',
    content: 'device eval turn',
    origin,
  });
  recordDeviceExecutionActor(conversationId, clientMessageId, principal);
  claimNextSessionInput(conversationId, runId);
  return { conversationId, runId };
}

describe('Device tool scenarios eval (P0-P2)', () => {
  beforeEach(() => {
    requireXopcDatabase();
  });

  it('Scenario 1: exposes source-phone capability summary and recalls every Chinese & English query accurately', async () => {
    const runtime = new EndpointToolRuntime({ audit: { started: vi.fn(), finished: vi.fn() } });
    try {
      registerEndpoint(runtime, {
        principalId: 'phone-a',
        endpointId: 'phone-a:ios',
        displayName: '我的 iPhone',
        kind: 'mobile',
        platform: 'ios',
        backgroundToolsSupported: true,
        tools: mobileToolSet(),
      });

      const sourceSnapshot = JSON.parse(deviceTurnSourceContext(runtime.registry.get('phone-a:ios')!).text);
      expect(sourceSnapshot).toMatchObject({
        endpointId: 'phone-a:ios',
        availability: 'foreground',
        backgroundToolsSupported: true,
      });
      expect(sourceSnapshot.capabilities).toEqual(expect.arrayContaining([
        'mobile.device.get_power',
        'mobile.device.get_location',
        'mobile.calendar.query_events',
        'mobile.contacts.find_by_name',
        'mobile.media.list_recent',
        'mobile.camera.capture',
      ]));

      const origin: TurnOrigin = { type: 'endpoint', endpointId: 'phone-a:ios' };
      const { conversationId, runId } = setupConversationWithActor(origin, {
        kind: 'device',
        principalId: 'phone-a',
        deviceId: 'phone-a',
        scopes: ['sessions.write'],
      });
      const context = () => ({ conversationId, channel: 'webchat', chatId: conversationId, origin });
      const provider = new EndpointToolProvider({ runtime, getCurrentContext: context });
      const gatewayTools = createExternalToolGatewayTools([provider], context, undefined, () => conversationId, ['endpoint']);
      const materialized = await runWithEmbeddedExecutionSession(
        conversationId,
        () => materializeNativeExternalTools({ conversationId, tools: gatewayTools }),
        runId,
      );

      expect(materialized.length).toBeGreaterThanOrEqual(12);
      expect(materialized.every(tool => getXopcToolMetadata(tool)?.external?.deviceRole === 'source')).toBe(true);
      expect(materialized.every(tool => tool.description.startsWith('[CURRENT SOURCE DEVICE]'))).toBe(true);

      const harness = createSearchHarness([...gatewayTools, ...materialized]);

      const queryExpectations: Array<readonly [string, string]> = [
        ['手机 电量', 'mobile_device_get_power'],
        ['查看 电池 充电 状态', 'mobile_device_get_power'],
        ['今天 日程 日历', 'mobile_calendar_query_events'],
        ['周五 空闲 忙碌', 'mobile_calendar_query_free_busy'],
        ['创建日程 新建日程', 'mobile_calendar_create_event'],
        ['查找 联系人 手机号', 'mobile_contacts_find_by_name'],
        ['最近照片 相册', 'mobile_media_list_recent'],
        ['整理相册 添加到相册', 'mobile_media_add_to_album'],
        ['拍照 相机', 'mobile_camera_capture'],
        ['附近 天气 定位', 'mobile_device_get_location'],
        ['选择文件', 'mobile_file_pick'],
        ['battery level', 'mobile_device_get_power'],
        ['calendar events', 'mobile_calendar_query_events'],
        ['recent photos', 'mobile_media_list_recent'],
      ];

      for (const [query, expectedToolFragment] of queryExpectations) {
        const result = await harness.runSearch(query, 8);
        const names = result.loadedTools.map(item => item.name);
        expect(names.some(name => name.includes(expectedToolFragment)), `query "${query}" should recall ${expectedToolFragment}, got ${JSON.stringify(names)}`).toBe(true);
      }

      // Dynamic backfill: when external connectors return 0 matches, native search can utilize full limit (> limit/2).
      const broad = await harness.runSearch('手机', 8);
      expect(broad.loadedTools.length).toBeGreaterThan(4);
      expect(broad.loadedTools.length).toBeLessThanOrEqual(8);
    } finally {
      runtime.close();
    }
  });

  it('Scenario 2 & 3: keeps source-phone personal reads working when Mac is bound and disambiguates multi-phone handoff', async () => {
    const runtime = new EndpointToolRuntime({ audit: { started: vi.fn(), finished: vi.fn() } });
    try {
      const phoneA = registerEndpoint(runtime, {
        principalId: 'phone-a',
        endpointId: 'phone-a:ios',
        displayName: '主力 iPhone',
        kind: 'mobile',
        platform: 'ios',
        tools: mobileToolSet(),
      });
      const phoneB = registerEndpoint(runtime, {
        principalId: 'phone-b',
        endpointId: 'phone-b:android',
        displayName: '备用 Android',
        kind: 'mobile',
        platform: 'android',
        tools: mobileToolSet(),
      });
      registerEndpoint(runtime, {
        principalId: 'mac-1',
        endpointId: 'mac-1:desktop',
        displayName: 'Work MacBook',
        kind: 'desktop',
        platform: 'darwin',
        tools: [deviceStateDescriptor('desktop', 'state')],
      });

      setMobileCapabilityAllowed('phone-a', 'mobile.calendar.create_event', true);
      setMobileCapabilityAllowed('phone-b', 'mobile.calendar.create_event', true);

      let currentOrigin: TurnOrigin = { type: 'endpoint', endpointId: 'phone-a:ios' };
      const { conversationId, runId } = setupConversationWithActor(currentOrigin, {
        kind: 'owner',
        principalId: 'gateway-owner',
        scopes: ['gateway.admin'],
      });

      // Bind Mac as execution target while user chats from Phone A.
      runtime.targets.select(conversationId, 'mac-1:desktop', Date.now(), 'gateway-owner');

      const context = () => ({ conversationId, channel: 'webchat', chatId: conversationId, origin: currentOrigin });
      const provider = new EndpointToolProvider({ runtime, getCurrentContext: context });
      const gatewayTools = createExternalToolGatewayTools([provider], context, undefined, () => conversationId, ['endpoint']);

      const turnATools = await runWithEmbeddedExecutionSession(
        conversationId,
        () => materializeNativeExternalTools({ conversationId, tools: gatewayTools }),
        runId,
      );

      // Personal reads on Phone A still resolve to Phone A even though Mac is selected as task target.
      for (const readTool of ['mobile_contacts_find_by_name', 'mobile_media_list_recent', 'mobile_media_read_image', 'mobile_calendar_query_events', 'mobile_device_get_power']) {
        const match = turnATools.find(tool => tool.name.includes(readTool) && getXopcToolMetadata(tool)?.external?.deviceRole === 'source');
        expect(match, `expected source-phone tool ${readTool} to remain available while Mac is bound`).toBeDefined();
      }

      // Now release Mac and switch conversation origin to Phone B (multi-phone handoff).
      runtime.targets.clear(conversationId);
      const turnAAll = await runWithEmbeddedExecutionSession(
        conversationId,
        () => materializeNativeExternalTools({ conversationId, tools: gatewayTools }),
        runId,
      );
      const phoneACalendarInTurnA = turnAAll.find(
        tool => getXopcToolMetadata(tool)?.external?.toolRef === 'endpoint:phone-a%3Aios:mobile.calendar.create_event',
      )!;
      expect(getXopcToolMetadata(phoneACalendarInTurnA)?.external?.deviceRole).toBe('source');
      const oldPhoneAContract = deferredToolContract(phoneACalendarInTurnA);

      currentOrigin = { type: 'endpoint', endpointId: 'phone-b:android' };
      const turnBTools = await runWithEmbeddedExecutionSession(
        conversationId,
        () => materializeNativeExternalTools({ conversationId, tools: gatewayTools }),
        runId,
      );
      const phoneACalendarInTurnB = turnBTools.find(
        tool => getXopcToolMetadata(tool)?.external?.toolRef === 'endpoint:phone-a%3Aios:mobile.calendar.create_event',
      )!;
      const phoneBCalendarInTurnB = turnBTools.find(
        tool => getXopcToolMetadata(tool)?.external?.toolRef === 'endpoint:phone-b%3Aandroid:mobile.calendar.create_event',
      )!;

      // Phone A demoted to 'other' (contract changes so stale discovery restore drops it); Phone B promoted to 'source'.
      expect(getXopcToolMetadata(phoneACalendarInTurnB)?.external?.deviceRole).toBe('other');
      expect(phoneACalendarInTurnB.description).toContain('[OTHER CONNECTED DEVICE]');
      expect(deferredToolContract(phoneACalendarInTurnB)).not.toBe(oldPhoneAContract);

      expect(getXopcToolMetadata(phoneBCalendarInTurnB)?.external?.deviceRole).toBe('source');
      expect(phoneBCalendarInTurnB.description).toContain('[CURRENT SOURCE DEVICE]');

      // tool_search ranks current source device (Phone B) strictly ahead of other phone (Phone A).
      const harness = createSearchHarness([...gatewayTools, ...turnBTools]);
      const searchResult = await harness.runSearch('创建日程 calendar create', 8);
      const calendarHits = searchResult.loadedTools.filter(item => item.name.includes('mobile_calendar_create_event'));
      expect(calendarHits.length).toBeGreaterThanOrEqual(2);
      expect(calendarHits[0].name).toBe(phoneBCalendarInTurnB.name);

      // Executing Phone B's tool dispatches strictly to Phone B's transport, never Phone A.
      const execPromise = runWithEmbeddedExecutionSession(
        conversationId,
        () => phoneBCalendarInTurnB.execute('call-b', { title: 'Sync', startAt: 1000, endAt: 2000 }),
        runId,
      );
      await vi.waitFor(() => expect(phoneB.sent).toHaveLength(1));
      expect(phoneA.sent).toHaveLength(0);
      const invocationId = String(phoneB.sent[0].payload.invocationId);
      runtime.invocations.handleMessage('phone-b:android', {
        protocolVersion: 3, messageId: randomUUID(), type: 'tool.received', sentAt: Date.now(), payload: { invocationId },
      });
      runtime.invocations.handleMessage('phone-b:android', {
        protocolVersion: 3, messageId: randomUUID(), type: 'tool.result', sentAt: Date.now(),
        payload: { invocationId, content: [{ type: 'json', value: { id: 'evt-b' } }] },
      });
      await expect(execPromise).resolves.toMatchObject({ details: { endpointId: 'phone-b:android' } });
    } finally {
      runtime.close();
    }
  });

  it('Scenario 4: prompt guidance distinguishes native device tools from phone_use and personal_task without leaking unavailable tools', () => {
    const withAll = buildSystemPrompt('/ws', {
      toolNames: ['tool_search', 'device_use', 'phone_use', 'device__mobile_device_get_power_1234567890ab'],
      channels: ['webchat'],
    });
    expect(withAll).toContain('[CURRENT SOURCE DEVICE]');
    expect(withAll).toContain('Prefer native `device__*` tools over `phone_use`');
    expect(withAll).toContain('use `device_use`');

    const minimal = buildSystemPrompt('/ws', { toolNames: ['read_file'], channels: ['webchat'] });
    expect(minimal).not.toContain('phone_use');
    expect(minimal).not.toContain('device_use');
    expect(minimal).not.toContain('tool_search');

    const personal = personalInstructions();
    expect(personal).toContain('current device\'s native capabilities');
    expect(personal).toContain('instead of delegating them to a background task');
  });

  it('Scenario 5 & 6: returns actionable validation, foreground, and permission diagnostics before bad dispatches', async () => {
    const runtime = new EndpointToolRuntime({ audit: { started: vi.fn(), finished: vi.fn() } });
    try {
      const phone = registerEndpoint(runtime, {
        principalId: 'phone-a',
        endpointId: 'phone-a:ios',
        displayName: '主力 iPhone',
        kind: 'mobile',
        platform: 'ios',
        availability: 'foreground',
        backgroundToolsSupported: true,
        tools: mobileToolSet(),
      });

      const locTool = runtime.registry.getTool('phone-a:ios', 'mobile.device.get_location')!;
      await expect(runtime.invocations.invoke({
        endpointId: 'phone-a:ios',
        toolCallId: 'bad-loc-enum',
        toolName: 'mobile.device.get_location',
        descriptorRevision: locTool.revision,
        arguments: { purpose: 'invalid', precision: 'approximate' },
      })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENTS',
        message: expect.stringContaining('weather, nearby'),
      });

      const calTool = runtime.registry.getTool('phone-a:ios', 'mobile.calendar.query_events')!;
      await expect(runtime.invocations.invoke({
        endpointId: 'phone-a:ios',
        toolCallId: 'bad-cal-range',
        toolName: 'mobile.calendar.query_events',
        descriptorRevision: calTool.revision,
        arguments: { startAt: 1000, endAt: 1000 + 8 * 86400000 },
      })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENTS',
        message: expect.stringContaining('604800000'),
      });

      // Cross-device unauthorized gatewayCapability gives actionable settings hint.
      await expect(runtime.invocations.invoke({
        endpointId: 'phone-a:ios',
        toolCallId: 'unauth-cap',
        toolName: 'mobile.calendar.query_events',
        descriptorRevision: calTool.revision,
        arguments: { startAt: 1000, endAt: 2000 },
        gatewayCapability: true,
      })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        message: expect.stringContaining('device settings'),
      });

      // Background phone without background grant returns actionable foreground guidance.
      runtime.registry.heartbeat('phone-a:ios', phone.connectionId, 'background');
      await expect(runtime.invocations.invoke({
        endpointId: 'phone-a:ios',
        toolCallId: 'bg-denied',
        toolName: 'mobile.calendar.query_events',
        descriptorRevision: calTool.revision,
        arguments: { startAt: 1000, endAt: 2000 },
      })).rejects.toMatchObject({
        code: 'ENDPOINT_NOT_FOREGROUND',
        message: expect.stringContaining('bring the app to the foreground'),
      });

      // Once mobile capability is allowed, background-readable calendar succeeds even in background.
      setMobileCapabilityAllowed('phone-a', 'mobile.calendar.query_events', true);
      const bgCall = runtime.invocations.invoke({
        endpointId: 'phone-a:ios',
        toolCallId: 'bg-allowed',
        toolName: 'mobile.calendar.query_events',
        descriptorRevision: calTool.revision,
        arguments: { startAt: 1000, endAt: 2000 },
      });
      expect(phone.sent).toHaveLength(1);
      const invocationId = String(phone.sent[0].payload.invocationId);
      runtime.invocations.handleMessage('phone-a:ios', {
        protocolVersion: 3, messageId: randomUUID(), type: 'tool.received', sentAt: Date.now(), payload: { invocationId },
      });
      runtime.invocations.handleMessage('phone-a:ios', {
        protocolVersion: 3, messageId: randomUUID(), type: 'tool.result', sentAt: Date.now(),
        payload: {
          invocationId,
          content: [{
            type: 'json',
            value: { capturedAt: Date.now(), startAt: 1000, endAt: 2000, timeZone: 'Asia/Shanghai', accessScope: 'all_accessible', truncated: false, events: [] },
          }],
        },
      });
      await expect(bgCall).resolves.toMatchObject({ content: [{ type: 'json' }] });
    } finally {
      runtime.close();
    }
  });
});
