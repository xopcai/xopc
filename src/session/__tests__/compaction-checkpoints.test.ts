import { describe, expect, it } from 'vitest';

import { normalizeCompactionCheckpointId } from '../compaction-checkpoints.js';

describe('normalizeCompactionCheckpointId', () => {
  it('accepts lowercase uuid', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(normalizeCompactionCheckpointId(id)).toBe(id);
  });

  it('normalizes uppercase uuid', () => {
    expect(normalizeCompactionCheckpointId('550E8400-E29B-41D4-A716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('extracts uuid from backup filename', () => {
    const id = 'a1b2c3d4-e5f6-4789-a012-345678901234';
    expect(normalizeCompactionCheckpointId(`main_telegram_default_dm_x.compaction-backup.${id}.json`)).toBe(id);
  });

  it('rejects invalid input', () => {
    expect(normalizeCompactionCheckpointId('')).toBeNull();
    expect(normalizeCompactionCheckpointId('../evil')).toBeNull();
    expect(normalizeCompactionCheckpointId('not-a-uuid')).toBeNull();
  });
});
