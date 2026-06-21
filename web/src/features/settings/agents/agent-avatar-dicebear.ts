import { createAvatar } from '@dicebear/core';
import {
  adventurer,
  bottts,
  funEmoji,
  lorelei,
  pixelArt,
  thumbs,
} from '@dicebear/collection';
import type { StoredDicebearStyleId } from './agent-avatar-dicebear-value';

export {
  DICEBEAR_MORE_SEEDS,
  DICEBEAR_ROW_SEEDS,
  DICEBEAR_STYLE_ORDER,
  XOPC_CUSTOM_AVATAR,
  buildXopcDicebearValue,
  isDicebearStyleId,
  parseXopcDicebearValue,
  type DicebearStyleId,
  type StoredDicebearStyleId,
} from './agent-avatar-dicebear-value';

export function dicebearToDataUri(styleId: StoredDicebearStyleId, seed: string, size = 128): string {
  const opts = { seed, size };
  switch (styleId) {
    case 'pixel-art':
      return createAvatar(pixelArt, opts).toDataUri();
    case 'adventurer':
      return createAvatar(adventurer, opts).toDataUri();
    case 'bottts':
      return createAvatar(bottts, opts).toDataUri();
    case 'lorelei':
      return createAvatar(lorelei, opts).toDataUri();
    case 'thumbs':
      return createAvatar(thumbs, opts).toDataUri();
    case 'fun-emoji':
      return createAvatar(funEmoji, opts).toDataUri();
  }
}

export function defaultAvatarDataUri(agentId: string, size = 128): string {
  return dicebearToDataUri('adventurer', agentId, size);
}
