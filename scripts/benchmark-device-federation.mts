/** Local catalog and deferred-search benchmark. No models, credentials or network. */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers/promises';

import type { ExtensionAPI, ToolDefinition, ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import type { CapabilityProvider } from '@xopcai/endpoint-tools-protocol';
import { EndpointToolRuntime } from '../src/endpoint-tools/runtime.js';
import { recordDeviceExecutionActor } from '../src/endpoint-tools/execution-actor.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';
import { insertSessionInput, claimNextSessionInput } from '../src/storage/sqlite/session-input-repository.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { EndpointToolProvider } from '../src/agent/external-tools/endpoint-provider.js';
import { createExternalToolGatewayTools } from '../src/agent/external-tools/gateway-tools.js';
import { materializeNativeExternalTools } from '../src/agent/embedded/external-tool-discovery.js';
import { createXopcToolSearchExtension } from '../src/agent/embedded/tool-search-extension.js';
import { xopcToolsToDefinitions } from '../src/agent/embedded/xopc-tools-bridge.js';

const root = mkdtempSync(join(tmpdir(), 'xopc-device-benchmark-'));
openXopcDatabase({ path: join(root, 'xopc.db') });
const runtime = new EndpointToolRuntime({ uploadRoot: root });
const gc = (globalThis as { gc?: () => void }).gc;
gc?.();
const memoryBefore = process.memoryUsage().heapUsed;
const eventLoop = monitorEventLoopDelay({ resolution: 10 });
eventLoop.enable();
await setImmediate();
let peakHeap = memoryBefore;
const percentile = (values: number[], p: number) => [...values].sort((a,b) => a-b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
try {
  const updates: number[] = [];
  for (let device = 0; device < 30; device++) {
    const id = `device${device}`;
    runtime.registry.register({ principalId: id, endpointId: id, connectionInstanceId: randomUUID(), displayName: id, kind: 'bridge',
      platform: 'benchmark', appVersion: '1', availability: 'background', nonce: randomUUID(), signedAt: Date.now(), signature: 'benchmark-signature', tools: [] }, id,
    { readyState: 1, send() {}, close() {} });
    const provider: CapabilityProvider = { localId: 'sensors', title: `${id} sensors`, summary: `Environment sensors on ${id}`, tools:
      Array.from({ length: 50 }, (_, index) => ({ name: `temperature${index}`, title: `${id} temperature${index}`,
        description: `Read temperature${index} sensor on ${id}. 设备${device} 温度${index} 传感器。`, inputSchema: { type: 'object', additionalProperties: false },
        effect: 'read', sensitivity: 'public', confirmation: 'never', requiresForeground: false, requiredPermissions: [], timeoutMs: 5_000,
        maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['text'] })) };
    const start = performance.now(); runtime.providers.replace(id, id, { revision: 1, providers: [provider] });
    runtime.providers.admit(id, 'sensors', runtime.providers.list(id)[0].digest, true);
    runtime.providers.reportState(id, id, { localId: 'sensors', catalogRevision: 1, sequence: 1, validForMs: 60_000, reason: 'ready' });
    updates.push(performance.now() - start);
  }
  const conversationId = createConversation({ agentId: 'main' }).key;
  recordDeviceExecutionActor(conversationId, 'benchmark', { kind: 'owner', principalId: 'benchmark-owner', scopes: ['gateway.admin'] });
  insertSessionInput({ id: randomUUID(), conversationId, clientMessageId: 'benchmark', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'Benchmark', origin: { type: 'system', source: 'cli' } });
  claimNextSessionInput(conversationId, 'benchmark-run');
  const context = () => ({ conversationId, chatId: conversationId, channel: 'webchat', origin: { type: 'system' as const, source: 'cli' as const } });
  const provider = new EndpointToolProvider({ runtime, getCurrentContext: context });
  const base = createExternalToolGatewayTools([provider], context, undefined, () => conversationId, ['endpoint']);
  const refresh = () => materializeNativeExternalTools({ conversationId, tools: base });
  const start = performance.now(), tools = await refresh(), materializationMs = performance.now() - start;
  const definitions = new Map<string, ToolDefinition>(xopcToolsToDefinitions(tools).map(tool => [tool.name, tool]));
  let active = ['tool_search'];
  const api = { registerTool: (tool: ToolDefinition) => { definitions.set(tool.name, tool); },
    getAllTools: () => [...definitions.values()], getActiveTools: () => active,
    setActiveTools: (names: string[]) => { active = names; }, appendEntry() {},
  } as unknown as ExtensionAPI;
  await createXopcToolSearchExtension(tools, { externalDiscovery: false, refreshNative: refresh })(api);
  const samples: number[] = [], loaded: number[] = [];
  const recall = { en: 0, zh: 0 };
  const firstHit = { en: 0, zh: 0 };
  for (let index = 0; index < 80; index++) {
    active = ['tool_search'];
    const target = `device${index % 30}`, sensor = `temperature${index % 50}`;
    const language = index < 40 ? 'en' : 'zh';
    const query = language === 'en' ? `${target} ${sensor}` : `设备${index % 30} 温度${index % 50} 传感器`;
    const start = performance.now();
    const result = await definitions.get('tool_search')!.execute(`search-${index}`, { query, limit: 8 }, new AbortController().signal, undefined, {} as ExtensionToolContext);
    samples.push(performance.now() - start);
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    loaded.push(payload.loadedTools.length);
    const exact = (tool: { name: string }) => definitions.get(tool.name)?.description.includes(`on ${target}.`)
      && definitions.get(tool.name)?.description.includes(`${sensor} sensor`);
    if (payload.loadedTools.some(exact)) recall[language]++;
    if (payload.loadedTools[0] && exact(payload.loadedTools[0])) firstHit[language]++;
    await setImmediate();
  }
  gc?.();
  eventLoop.disable();
  console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
    devices: 30, tools: tools.length, localOnly: true, materializationMs, catalogUpdateP95Ms: percentile(updates,.95),
    searchP50Ms: percentile(samples,.5), searchP95Ms: percentile(samples,.95), queries: samples.length, exactTargetRecallAt8: { en: recall.en / 40, zh: recall.zh / 40 },
    exactTargetFirstHit: { en: firstHit.en / 40, zh: firstHit.zh / 40 }, eventLoopDelayP95Ms: eventLoop.percentile(95) / 1e6,
    maximumLoadedTools: Math.max(...loaded), initialDeviceToolsInPrompt: 0, gcAvailable: Boolean(gc), peakHeapGrowthBytes: peakHeap - memoryBefore, retainedHeapGrowthBytes: process.memoryUsage().heapUsed - memoryBefore }, null, 2));
} finally { eventLoop.disable(); runtime.close(); closeXopcDatabase(); rmSync(root, { recursive: true, force: true }); }
