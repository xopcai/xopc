import { createHmac, randomUUID } from 'node:crypto';

import type { BrowserPreviewIce } from '@xopcai/realtime-protocol';

import { createLogger } from '../utils/logger.js';

const log = createLogger('BrowserPreview');
let lastInvalidTurnSignature: string | undefined;

export function browserPreviewIce(env: NodeJS.ProcessEnv = process.env, now = Date.now()): BrowserPreviewIce {
  const rawUrls = env.XOPC_BROWSER_PREVIEW_TURN_URLS?.trim() ?? '';
  const urls = rawUrls ? rawUrls.split(',').map(url => url.trim()).filter(Boolean) : [];
  const secret = env.XOPC_BROWSER_PREVIEW_TURN_SECRET;
  const invalidUrls = urls.length > 8
    || urls.some(url => !/^turns?:[a-zA-Z\d.:[\]-]+(?::\d+)?(?:\?transport=(?:udp|tcp))?$/.test(url) || url.length > 512);
  if (!secret || !urls.length || invalidUrls) {
    if (rawUrls) {
      const reason = !secret ? 'missing_secret' : urls.length > 8 ? 'too_many_urls' : 'invalid_url';
      const signature = `${reason}:${rawUrls}`;
      if (signature !== lastInvalidTurnSignature) {
        lastInvalidTurnSignature = signature;
        log.warn({ reason, urlCount: urls.length }, `Browser preview TURN configuration ignored (${reason}); falling back to direct ICE`);
      }
    }
    return { iceServers: [], iceTransportPolicy: 'all' };
  }
  lastInvalidTurnSignature = undefined;
  const username = `${Math.floor(now / 1000) + 600}:${randomUUID()}`;
  return {
    iceServers: [{ urls, username, credential: createHmac('sha1', secret).update(username).digest('base64') }],
    iceTransportPolicy: env.XOPC_BROWSER_PREVIEW_FORCE_RELAY === '1' ? 'relay' : 'all',
  };
}
