import { gatewaySession } from '../service/gatewaySession';
import { prepareDeviceCapabilityPermission } from '../service/devicePersonalTools';

export interface XopcConnectionFolder { id: string; kind: string; label: string; }
export interface XopcReportedCapability { name: string; title: string; titleZh: string; allowed: boolean; }
export interface XopcConnectedDevice {
  id: string; name: string; kind: string; platform: string; endpointId?: string;
  availability: string; tools: string[]; folders: XopcConnectionFolder[];
  capabilities?: XopcReportedCapability[];
}
export interface XopcDeviceConnections { currentDeviceId?: string; devices: XopcConnectedDevice[]; }
interface XopcDeviceConnectionsEnvelope { ok: boolean; payload?: XopcDeviceConnections; }
interface XopcDeviceConnectionChat { conversationId: string; agentId: string; }
interface XopcDeviceConnectionChatEnvelope { ok: boolean; payload?: XopcDeviceConnectionChat; }
interface XopcDeviceConnectionChatInput { endpointId: string; }
interface XopcDeviceCapabilityChange { toolName: string; allowed: boolean; }

export async function loadDeviceConnections(): Promise<XopcDeviceConnections> {
  const revision = gatewaySession.connectionRevision();
  const response = JSON.parse(await gatewaySession.request('/api/endpoint-tools/device-connections')) as XopcDeviceConnectionsEnvelope;
  gatewaySession.assertConnection(revision);
  if (!response.ok || !response.payload || !Array.isArray(response.payload.devices)) throw new Error('DEVICE_CONNECTIONS_UNAVAILABLE');
  return response.payload;
}

export async function setDeviceCapability(name: string, allowed: boolean, deviceId: string): Promise<void> {
  const revision = gatewaySession.connectionRevision();
  if (gatewaySession.currentProfile()?.deviceId !== deviceId) throw new Error('GATEWAY_CHANGED');
  if (allowed) await prepareDeviceCapabilityPermission(name);
  gatewaySession.assertConnection(revision);
  const input: XopcDeviceCapabilityChange = { toolName: name, allowed };
  await gatewaySession.request('/api/endpoint-tools/device-connections', 'PATCH', JSON.stringify(input));
  gatewaySession.assertConnection(revision);
}

export async function openDeviceConnectionChat(endpointId: string): Promise<string> {
  const revision = gatewaySession.connectionRevision();
  const input: XopcDeviceConnectionChatInput = { endpointId };
  const response = JSON.parse(await gatewaySession.request('/api/endpoint-tools/device-connections/chat', 'POST',
    JSON.stringify(input))) as XopcDeviceConnectionChatEnvelope;
  gatewaySession.assertConnection(revision);
  if (!response.ok || !response.payload?.conversationId) throw new Error('DEVICE_CHAT_UNAVAILABLE');
  return response.payload.conversationId;
}

export interface XopcDesktopChatTarget {
  deviceName?: string; deviceState?: string; reselectEndpointId?: string;
}
interface XopcDesktopChatTargetEnvelope { ok: boolean; payload?: XopcDesktopChatTarget; }

export async function loadDesktopChatTarget(conversationId: string): Promise<XopcDesktopChatTarget | undefined> {
  const revision = gatewaySession.connectionRevision();
  const path = '/api/endpoint-tools/targets/' + encodeURIComponent(conversationId);
  const response = JSON.parse(await gatewaySession.request(path)) as XopcDesktopChatTargetEnvelope;
  gatewaySession.assertConnection(revision);
  return response.ok && response.payload?.deviceName ? response.payload : undefined;
}

export async function reselectDesktopChatTarget(conversationId: string, endpointId: string): Promise<void> {
  const revision = gatewaySession.connectionRevision();
  const input: XopcDeviceConnectionChatInput = { endpointId };
  const path = '/api/endpoint-tools/targets/' + encodeURIComponent(conversationId);
  await gatewaySession.request(path, 'PUT', JSON.stringify(input));
  gatewaySession.assertConnection(revision);
}
