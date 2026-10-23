export const XOPC_CUSTOM_AVATAR = 'xopc:custom';
const XOPC_DICEBEAR_PREFIX = 'xopc:dicebear:';

/** Styles offered in the avatar picker. */
export type DicebearStyleId = 'adventurer' | 'bottts' | 'lorelei' | 'thumbs' | 'fun-emoji';

export const DICEBEAR_STYLE_ORDER: readonly DicebearStyleId[] = [
  'adventurer',
  'bottts',
  'lorelei',
  'thumbs',
  'fun-emoji',
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
