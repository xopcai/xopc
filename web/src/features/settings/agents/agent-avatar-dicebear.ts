import { createAvatar } from '@dicebear/core';
import { adventurer, bottts, lorelei, pixelArt } from '@dicebear/collection';

export const XOPC_CUSTOM_AVATAR = 'xopc:custom';
export const XOPC_DICEBEAR_PREFIX = 'xopc:dicebear:';

export type DicebearStyleId = 'pixel-art' | 'adventurer' | 'bottts' | 'lorelei';

export const DICEBEAR_STYLE_ORDER: readonly DicebearStyleId[] = [
  'pixel-art',
  'adventurer',
  'bottts',
  'lorelei',
] as const;

/** Short list for the main horizontal row. */
export const DICEBEAR_ROW_SEEDS = ['Avery', 'Blake', 'Casey', 'Drew', 'Eden'] as const;

/** Extra seeds shown under "More". */
export const DICEBEAR_MORE_SEEDS = [
  'Fern',
  'Gray',
  'Harper',
  'Indigo',
  'Jules',
  'Kai',
  'Lane',
  'Morgan',
  'Noel',
  'Oakley',
  'Parker',
  'Quinn',
  'Reese',
  'Sage',
  'Tatum',
] as const;

export function isDicebearStyleId(s: string): s is DicebearStyleId {
  return (DICEBEAR_STYLE_ORDER as readonly string[]).includes(s);
}

export function buildXopcDicebearValue(styleId: DicebearStyleId, seed: string): string {
  return `${XOPC_DICEBEAR_PREFIX}${styleId}:${seed}`;
}

export function parseXopcDicebearValue(
  raw: string,
): { styleId: DicebearStyleId; seed: string } | null {
  if (!raw.startsWith(XOPC_DICEBEAR_PREFIX)) {
    return null;
  }
  const rest = raw.slice(XOPC_DICEBEAR_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) {
    return null;
  }
  const styleId = rest.slice(0, colon);
  const seed = rest.slice(colon + 1);
  if (!isDicebearStyleId(styleId) || !seed.trim()) {
    return null;
  }
  return { styleId, seed };
}

export function dicebearToDataUri(styleId: DicebearStyleId, seed: string, size = 128): string {
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
  }
}

export function defaultAvatarDataUri(agentId: string, size = 128): string {
  return dicebearToDataUri('pixel-art', agentId, size);
}
