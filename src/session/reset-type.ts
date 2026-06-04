import type { Config } from '../config/schema.js';
import { normalizeLowercaseStringOrEmpty, normalizeOptionalLowercaseString } from '../utils/string-coerce.js';

import type { SessionResetConfig, SessionResetType } from './reset-policy.js';

const GROUP_SESSION_MARKERS = [':group:', ':channel:'];

export function isThreadSessionKey(sessionKey?: string | null): boolean {
  const raw = (sessionKey ?? '').trim();
  return raw.includes(':thread:');
}

export function resolveSessionResetType(params: {
  sessionKey?: string | null;
  isGroup?: boolean;
  isThread?: boolean;
}): SessionResetType {
  if (params.isThread || isThreadSessionKey(params.sessionKey)) {
    return 'thread';
  }
  if (params.isGroup) {
    return 'group';
  }
  const normalized = normalizeLowercaseStringOrEmpty(params.sessionKey);
  if (GROUP_SESSION_MARKERS.some((marker) => normalized.includes(marker))) {
    return 'group';
  }
  return 'direct';
}

export function resolveChannelResetConfig(params: {
  sessionCfg?: Config['session'];
  channel?: string | null;
}): SessionResetConfig | undefined {
  const resetByChannel = params.sessionCfg?.resetByChannel;
  if (!resetByChannel) {
    return undefined;
  }
  const key = normalizeOptionalLowercaseString(params.channel);
  if (!key) {
    return undefined;
  }
  return resetByChannel[key];
}
