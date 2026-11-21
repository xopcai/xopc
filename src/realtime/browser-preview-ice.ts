import { createHmac, randomUUID } from 'node:crypto';

import type { BrowserPreviewIce } from '@xopcai/realtime-protocol';

export function browserPreviewIce(env: NodeJS.ProcessEnv = process.env, now = Date.now()): BrowserPreviewIce {
  const urls = env.XOPC_BROWSER_PREVIEW_TURN_URLS?.split(',').map(url => url.trim()).filter(Boolean) ?? [];
  const secret = env.XOPC_BROWSER_PREVIEW_TURN_SECRET;
  if (!secret || !urls.length || urls.length > 8 || urls.some(url => !/^turns?:[a-zA-Z\d.:[\]-]+(?::\d+)?(?:\?transport=(?:udp|tcp))?$/.test(url) || url.length > 512)) {
    return { iceServers: [], iceTransportPolicy: 'all' };
  }
  const username = `${Math.floor(now / 1000) + 600}:${randomUUID()}`;
  return {
    iceServers: [{ urls, username, credential: createHmac('sha1', secret).update(username).digest('base64') }],
    iceTransportPolicy: env.XOPC_BROWSER_PREVIEW_FORCE_RELAY === '1' ? 'relay' : 'all',
  };
}
