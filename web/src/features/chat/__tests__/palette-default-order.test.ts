import { describe, it, expect } from 'vitest';
import type { PaletteItem } from '@/features/chat/command-palette.types';
import { paletteDefaultTiebreak } from '@/features/chat/palette-default-order';

function cmd(
  name: string,
  category: NonNullable<PaletteItem['category']> = 'session',
): PaletteItem {
  return {
    kind: 'command',
    id: `cmd:${name}`,
    name,
    description: '',
    category,
  };
}

function skill(name: string): PaletteItem {
  return {
    kind: 'skill',
    id: `skill:${name}`,
    name,
    description: '',
    category: 'skill',
  };
}

describe('paletteDefaultTiebreak', () => {
  it('orders curated commands before middle tier and defer last', () => {
    expect(paletteDefaultTiebreak(cmd('new'), skill('aaa'))).toBeLessThan(0);
    expect(paletteDefaultTiebreak(skill('aaa'), cmd('new'))).toBeGreaterThan(0);
    expect(paletteDefaultTiebreak(skill('zzz'), cmd('abort'))).toBeLessThan(0);
    expect(paletteDefaultTiebreak(cmd('abort'), skill('aaa'))).toBeGreaterThan(0);
  });

  it('interleaves skills and non-curated commands alphabetically in the middle tier', () => {
    expect(paletteDefaultTiebreak(skill('alpha'), cmd('beta', 'extension'))).toBeLessThan(0);
    expect(paletteDefaultTiebreak(cmd('beta', 'extension'), skill('alpha'))).toBeGreaterThan(0);
  });

  it('orders curated commands by COMMAND_WEIGHT', () => {
    expect(paletteDefaultTiebreak(cmd('new'), cmd('help'))).toBeLessThan(0);
    expect(paletteDefaultTiebreak(cmd('help'), cmd('new'))).toBeGreaterThan(0);
  });
});
