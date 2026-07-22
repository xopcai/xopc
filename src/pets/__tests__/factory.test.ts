import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDesktopPetPackage, DESKTOP_PET_ACTIONS } from '../factory.js';
import { validateDesktopPetPackage } from '../validator.js';

describe('createDesktopPetPackage', () => {
  it('writes a complete desktop pet package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-pet-factory-'));
    try {
      const result = await createDesktopPetPackage({
        targetDir: root,
        name: 'Blue Terminal Buddy',
        prompt: 'a sleepy blue robot that loves terminals',
        persona: {
          tone: 'warm',
          warmth: 0.8,
          energy: 0.3,
          humor: 0.1,
          phrases: { success: ['处理好了。'] },
        },
      });

      await expect(stat(result.manifestPath)).resolves.toBeTruthy();
      await expect(stat(result.thumbnailPath)).resolves.toBeTruthy();
      await expect(stat(result.spritesheetPath)).resolves.toBeTruthy();
      await expect(validateDesktopPetPackage(result.dir)).resolves.toEqual({ ok: true });

      const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
        id: string;
        sourcePrompt: string;
        animations: Record<string, unknown>;
        persona: { tone: string; phrases?: { success?: string[] } };
      };
      expect(manifest.id).toBe(result.id);
      expect(manifest.sourcePrompt).toBe('a sleepy blue robot that loves terminals');
      expect(Object.keys(manifest.animations)).toEqual([...DESKTOP_PET_ACTIONS]);
      expect(manifest.persona).toMatchObject({ tone: 'warm', phrases: { success: ['处理好了。'] } });
      const entries = await readdir(root);
      expect(entries.some((entry) => entry.startsWith('.tmp-'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('updates an existing desktop pet package in place', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-pet-factory-update-'));
    try {
      const first = await createDesktopPetPackage({
        targetDir: root,
        name: 'Blue Terminal Buddy',
        prompt: 'a sleepy blue robot that loves terminals',
        persona: { tone: 'calm', warmth: 0.7, energy: 0.25, humor: 0.05 },
      });
      const updated = await createDesktopPetPackage({
        targetDir: root,
        id: `custom:${first.id}`,
        prompt: 'same robot, larger eyes, softer rounded laptop animation',
        overwrite: true,
      });

      expect(updated.id).toBe(first.id);
      expect(updated.dir).toBe(first.dir);
      const manifest = JSON.parse(await readFile(updated.manifestPath, 'utf8')) as {
        name: string;
        sourcePrompt: string;
        persona?: { tone: string };
      };
      expect(manifest.name).toBe('Blue Terminal Buddy');
      expect(manifest.sourcePrompt).toBe('same robot, larger eyes, softer rounded laptop animation');
      expect(manifest.persona?.tone).toBe('calm');
      await expect(validateDesktopPetPackage(updated.dir)).resolves.toEqual({ ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
