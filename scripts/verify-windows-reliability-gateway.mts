/** Isolated real Gateway worker. IPC only supplies test commands; desktop traffic is HTTP/WS. */
import assert from 'node:assert/strict';
import { basename, dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { GatewayServer } from '../src/gateway/server.js';
import { closeXopcDatabase } from '../src/storage/sqlite/connection.js';

const root = process.env.XOPC_STATE_DIR!;
assert.match(basename(dirname(root)), /^windows-reliability-[a-f0-9-]{36}$/);
const config = JSON.parse(await readFile(join(root, 'xopc.json'), 'utf8'));
const gateway = new GatewayServer({ port: config.gateway.port, bindHost: '127.0.0.1', bind: 'loopback', configPath: join(root, 'xopc.json'), enableHotReload: false });
await gateway.start();
if (!(gateway as any).server.listening) await once((gateway as any).server, 'listening');
const endpoints = gateway.serviceInstance.endpointTools;
let frames = 0;
process.on('message', async (message: any) => {
  try {
    let value: unknown;
    if (message.op === 'status') value = { endpoints: endpoints.registry.list(), frames };
    else if (message.op === 'invoke') {
      const tool = endpoints.registry.getTool(message.endpointId, COMPUTER_DESCRIPTOR.name); assert.ok(tool);
      const result = await endpoints.invocations.invoke({ endpointId: message.endpointId, toolCallId: message.id,
        toolName: COMPUTER_DESCRIPTOR.name, descriptorRevision: tool.revision, arguments: message.command });
      for (const item of result.content) if (item.type === 'file' && result.invocationId) {
        const frame = endpoints.uploads.takeComputerFrame(item.fileId, result.invocationId);
        if (frame) { frames++; frame.fill(0); }
      }
      value = result.content.find(item => item.type === 'json');
    } else if (message.op === 'stop') {
      await gateway.stop(); closeXopcDatabase(); process.send?.({ id: message.id, value: true }, () => process.exit(0)); return;
    } else throw new Error('Unknown test operation');
    process.send?.({ id: message.id, value });
  } catch (error) { process.send?.({ id: message.id, error: (error as any).code ?? 'RELIABILITY_GATEWAY_FAILED' }); }
});
process.send?.({ ready: true });
