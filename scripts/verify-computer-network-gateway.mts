/** Private IPC drives test inputs; all desktop traffic uses the production Gateway listener. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { GatewayServer } from '../src/gateway/server.js';
import { AgentCatalogRepository } from '../src/agent-catalog/repository.js';
import { AgentDefaultsSchema } from '../src/agent-config/index.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';
import { computerDiagnostic } from '../src/computer/errors.js';
import { ComputerRuntime } from '../src/computer/runtime.js';
import { isComputerControlActive } from '../src/computer/control-guard.js';

const root = process.env.XOPC_STATE_DIR!;
assert.match(basename(root), /^xopc-network-flow-[A-Za-z0-9]+$/);
const config = JSON.parse(await readFile(join(root, 'xopc.json'), 'utf8'));
openXopcDatabase({ path: join(root, 'xopc.db') });
const catalog = new AgentCatalogRepository();
catalog.ensureInitialized(AgentDefaultsSchema.parse({ models: { chat: { primary: 'dashscope-cn/qwen-plus' } } }));
if (!catalog.get('network-validation')) catalog.create({ id: 'network-validation', workspace: join(root, 'workspace'),
  models: { computerUse: { primary: 'dashscope-cn/gui-plus-2026-02-26' } } } as any, { ready: true });
let lastError: unknown;
let modelRequests = 0, hostedResponses = 0, hintRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const address = new URL(String(url));
  if (address.hostname === 'dashscope.aliyuncs.com') {
    assert.equal(address.href, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'gui-plus-2026-02-26');
    assert.equal(init?.redirect, 'error');
    assert.match(body.messages[1].content[0].image_url.url, /^data:image\/(png|jpeg);base64,/);
    if (body.messages[1].content[1].text.includes('Untrusted historical navigation hints')) hintRequests++;
    modelRequests++;
    const response = await originalFetch(url, init); if (response.ok) hostedResponses++;
    return response;
  }
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname), 'Unexpected external request');
  return originalFetch(url, init);
};
const gateway = new GatewayServer({ port: config.gateway.port, bindHost: '127.0.0.1', bind: 'loopback',
  configPath: join(root, 'xopc.json'), enableHotReload: false });
await gateway.start();
const listener = (gateway as any).server;
if (!listener.listening) await once(listener, 'listening');
const service = gateway.serviceInstance;
const runtime = new ComputerRuntime(service.endpointTools, () => service.currentConfig);
const owner = createConversation({ agentId: 'network-validation', sourceChannel: 'webchat' }, join(root, 'workspace')).key;
process.on('message', async (message: any) => {
  try {
    let value: unknown;
    switch (message.op) {
      case 'execute': value = await runtime.execute(owner, message.input); break;
      case 'status': value = { pid: process.pid, owner, endpoints: service.endpointTools.registry.list(), modelRequests, hostedResponses, hintRequests,
        retainedFrames: (service.endpointTools.uploads as any).frames.size, lastError, report: runtime.getReport(owner), controlActive: isComputerControlActive(owner) }; break;
      case 'stop': await runtime.shutdown(); await gateway.stop(); closeXopcDatabase(); await new Promise<void>(resolve => process.send!({ id: message.id, value: true }, () => resolve())); process.exit(0);
      default: throw new Error('Unknown private test command');
    }
    process.send?.({ id: message.id, value });
  } catch (error) {
    lastError = { operation: message.op, input: message.input?.op, name: error instanceof Error ? error.name : 'Unknown', code: typeof (error as any)?.code === 'string' && /^[A-Z_]{1,80}$/.test((error as any).code) ? (error as any).code : undefined };
    process.send?.({ id: message.id, error: computerDiagnostic(error)?.errorCode ?? (error instanceof Error && /^COMPUTER_[A-Z_0-9]+$/.test(error.message) ? error.message : 'VALIDATION_GATEWAY_OPERATION_FAILED') });
  }
});
process.send?.({ ready: true, pid: process.pid, owner });
