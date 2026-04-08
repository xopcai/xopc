import type { PaletteItem } from '@/features/chat/command-palette.types';

/**
 * Curated slash commands shown first when match rank ties (empty search or same rank).
 * Order follows this map (lower = earlier).
 */
const COMMAND_WEIGHT: Readonly<Record<string, number>> = {
  new: 10,
  help: 11,
  list: 12,
  clear: 13,
  switch: 14,
  models: 15,
  usage: 16,
  skills: 17,
  settings: 18,
  start: 19,
  think: 20,
  reasoning: 21,
  verbose: 22,
  status: 23,
  tts: 24,
};

const DEFER_COMMANDS = new Set(['abort', 'archive']);

/** 0 = curated command, 1 = skills + everything else, 2 = defer */
function paletteTier(item: PaletteItem): number {
  if (item.kind === 'command') {
    const n = item.name.toLowerCase();
    if (COMMAND_WEIGHT[n] !== undefined) {
      return 0;
    }
    if (DEFER_COMMANDS.has(n)) {
      return 2;
    }
  }
  return 1;
}

/**
 * When {@link paletteItemMatchRank} ties: curated commands first, then skills and other commands
 * **mixed alphabetically**, then defer (abort/archive) last — avoids one big “all skills” block.
 */
export function paletteDefaultTiebreak(a: PaletteItem, b: PaletteItem): number {
  const ta = paletteTier(a);
  const tb = paletteTier(b);
  if (ta !== tb) {
    return ta - tb;
  }

  if (ta === 0) {
    const wa = COMMAND_WEIGHT[a.name.toLowerCase()] ?? 999;
    const wb = COMMAND_WEIGHT[b.name.toLowerCase()] ?? 999;
    if (wa !== wb) {
      return wa - wb;
    }
  }

  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) {
    return byName;
  }
  return a.id.localeCompare(b.id);
}
