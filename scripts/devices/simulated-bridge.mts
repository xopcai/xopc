import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDeviceBridge, simulatedEnvironmentSensors } from '../../src/endpoint-tools/bridge.js';
import { connectDeviceBridge } from '../../src/endpoint-tools/bridge-host.js';

const gatewayUrl = process.env.XOPC_GATEWAY_URL ?? 'http://127.0.0.1:18790';
const token = process.env.XOPC_GATEWAY_TOKEN;
if (!token) throw new Error('Set XOPC_GATEWAY_TOKEN to the Gateway owner token');
const bridge = await connectDeviceBridge({ gatewayUrl, token,
  identityPath: process.env.XOPC_BRIDGE_IDENTITY_PATH ?? join(homedir(), '.xopc', 'devices', 'simulated-bridge.json'),
  displayName: 'Simulated environment Bridge', registry: createDeviceBridge(simulatedEnvironmentSensors()),
});
console.log(JSON.stringify({ ready: true, simulated: true, endpointId: bridge.endpointId,
  resources: simulatedEnvironmentSensors().map(adapter => adapter.resource) }, null, 2));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { bridge.close(); });
