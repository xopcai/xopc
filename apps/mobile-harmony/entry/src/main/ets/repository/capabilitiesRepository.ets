import { gatewaySession } from '../service/gatewaySession';
import { appSettings } from '../service/settings';

export interface XopcCapabilityItem {
  id: string;
  name: string;
  group: string;
  description?: string;
  avatar?: string;
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
