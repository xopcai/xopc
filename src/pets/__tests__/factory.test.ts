import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDesktopPetPackage, DESKTOP_PET_ACTIONS } from '../factory.js';

describe('createDesktopPetPackage', () => {
  it('writes a complete desktop pet package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-pet-factory-'));
    try {
      const result = await createDesktopPetPackage({
        targetDir: root,
        name: 'Blue Terminal Buddy',
        prompt: 'a sleepy blue robot that loves terminals',
      });

      await expect(stat(result.manifestPath)).resolves.toBeTruthy();
      await expect(stat(result.thumbnailPath)).resolves.toBeTruthy();
      await expect(stat(result.spritesheetPath)).resolves.toBeTruthy();

      const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
        id: string;
        sourcePrompt: string;
        animations: Record<string, unknown>;
      };
      expect(manifest.id).toBe(result.id);
      expect(manifest.sourcePrompt).toBe('a sleepy blue robot that loves terminals');
      expect(Object.keys(manifest.animations)).toEqual([...DESKTOP_PET_ACTIONS]);
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
      };
      expect(manifest.name).toBe('Blue Terminal Buddy');
      expect(manifest.sourcePrompt).toBe('same robot, larger eyes, softer rounded laptop animation');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
