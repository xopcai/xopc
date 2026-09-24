import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyMigrations, detectMigrations } from '../runner.js';

describe('retired local STT migration', () => {
  it('disables legacy local STT without deleting its provider settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-retired-local-stt-'));
    const path = join(root, 'xopc.json');
    writeFileSync(path, JSON.stringify({
      tools: {
        media: {
          audio: {
            enabled: true,
            provider: 'xopc-local',
            providers: { 'xopc-local': { model: 'sensevoice-small' } },
          },
        },
      },
    }));

    expect(detectMigrations(path).map((entry) => entry.id)).toContain('retire-builtin-local-stt');
    expect(applyMigrations(path).changed).toBe(true);

    const migrated = JSON.parse(readFileSync(path, 'utf8'));
    expect(migrated.tools.media.audio).toMatchObject({
      enabled: false,
      provider: 'openai',
      fallback: { enabled: false, order: [] },
      providers: { 'xopc-local': { model: 'sensevoice-small' } },
    });
  });

  it('does not change configured extension providers', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-external-stt-'));
    const path = join(root, 'xopc.json');
    writeFileSync(path, JSON.stringify({
      tools: { media: { audio: { enabled: true, provider: 'my-local-stt' } } },
    }));

    expect(detectMigrations(path).map((entry) => entry.id)).not.toContain('retire-builtin-local-stt');
  });
});
