import { gatewaySession } from '../service/gatewaySession';
import { appSettings } from '../service/settings';

export interface XopcCapabilityItem {
  id: string;
  name: string;
  group: string;
  description?: string;
  avatar?: string;
  iconUrl?: string;
  targetId?: string;
  version?: string;
  issue?: string;
}

export interface XopcCapabilityPage {
  items: XopcCapabilityItem[];
  incomplete?: boolean;
}

interface CapabilityEnvelope {
  ok: boolean;
  payload?: XopcCapabilityPage;
}

interface ConversationMcpEnvelope { ok: boolean; payload?: ConversationMcpAvailability; }
interface ConversationMcpAvailability { available?: boolean; }

export async function hasConversationMcpSetup(conversationId: string): Promise<boolean> {
  const revision = gatewaySession.connectionRevision();
  const url = '/api/capabilities/mobile-actions/panel/connections?id=' + encodeURIComponent('conversation:' + conversationId);
  const response = JSON.parse(await gatewaySession.request(url)) as ConversationMcpEnvelope;
  gatewaySession.assertConnection(revision);
  return response.ok && response.payload?.available === true;
}

export async function loadCapabilities(category: string): Promise<XopcCapabilityPage> {
  const locale = encodeURIComponent(appSettings.effectiveLanguage());
  const connection = gatewaySession.connectionRevision();
  const path = '/api/capabilities/mobile-catalog?category=' + encodeURIComponent(category) + '&locale=' + locale;
  const response = JSON.parse(await gatewaySession.request(path)) as CapabilityEnvelope;
  gatewaySession.assertConnection(connection);
  const page = response.payload;
  if (!response.ok || !page || !Array.isArray(page.items)) throw new Error('INVALID_CAPABILITY_CATALOG');
  return page;
}
