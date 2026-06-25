import type { Config } from '../config/schema.js';
import { normalizeOptionalLowercaseString } from '../utils/string-coerce.js';

import type { SessionResetConfig, SessionResetType } from './reset-policy.js';

export function resolveSessionResetType(params: {
  isGroup?: boolean;
  isThread?: boolean;
}): SessionResetType {
  if (params.isThread) {
    return 'thread';
  }
  if (params.isGroup) {
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
