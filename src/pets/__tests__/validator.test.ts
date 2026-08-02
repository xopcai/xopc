import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DESKTOP_PET_ACTIONS } from '../manifest.js';
import { validateDesktopPetPackage } from '../validator.js';

describe('validateDesktopPetPackage', () => {
  it('rejects pre-v2 manifests and unknown animation actions', async () => {
    const root = join(tmpdir(), `xopc-pet-validator-version-${Date.now()}`);
    await mkdir(root, { recursive: true });
    try {
      await writeFile(
        join(root, 'pet.svg'),
        `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="${DESKTOP_PET_ACTIONS.length * 96}" viewBox="0 0 96 ${DESKTOP_PET_ACTIONS.length * 96}"></svg>`,
        'utf8',
      );
      const animation = (row: number) => ({
        src: 'pet.svg', frameWidth: 96, frameHeight: 96, frameCount: 1,
        fps: 6, loop: true, offsetX: 0, offsetY: row * 96,
      });
      await writeFile(join(root, 'manifest.json'), `${JSON.stringify({
        schemaVersion: 1,
        id: 'old-format',
        name: 'Old format',
        description: 'Must not be accepted',
        thumbnail: 'pet.svg',
        canvasWidth: 96,
        canvasHeight: 96,
        animations: {
          ...Object.fromEntries(DESKTOP_PET_ACTIONS.map((action, row) => [action, animation(row)])),
          typing: animation(0),
        },
      }, null, 2)}\n`, 'utf8');

      const result = await validateDesktopPetPackage(root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issue.details).toEqual(expect.arrayContaining([
          'schemaVersion must be 2',
          'typing: unsupported animation action',
        ]));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects missing required animation actions', async () => {
    const root = join(tmpdir(), `xopc-pet-validator-${Date.now()}`);
    await mkdir(root, { recursive: true });
    try {
      await writeFile(
        join(root, 'pet.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"></svg>',
        'utf8',
      );
      await writeFile(
        join(root, 'manifest.json'),
        `${JSON.stringify(
          {
            schemaVersion: 2,
            id: 'broken',
            name: 'Broken',
            description: 'Missing most animation rows',
            thumbnail: 'pet.svg',
            canvasWidth: 96,
            canvasHeight: 96,
            animations: {
              idle: {
                src: 'pet.svg',
                frameWidth: 96,
                frameHeight: 96,
                frameCount: 1,
                fps: 6,
                loop: true,
                offsetX: 0,
                offsetY: 0,
              },
            },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      const result = await validateDesktopPetPackage(root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issue.details).toEqual(
          expect.arrayContaining(DESKTOP_PET_ACTIONS.slice(1).map((action) => `${action}: animation must be an object`)),
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects spritesheet dimensions smaller than the manifest requires', async () => {
    const root = join(tmpdir(), `xopc-pet-validator-bounds-${Date.now()}`);
    await mkdir(root, { recursive: true });
    try {
      await writeFile(
        join(root, 'pet.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"></svg>',
        'utf8',
      );
      await writeFile(
        join(root, 'manifest.json'),
        `${JSON.stringify(
          {
            schemaVersion: 2,
            id: 'cropped',
            name: 'Cropped',
            description: 'Sheet is too small',
            thumbnail: 'pet.svg',
            canvasWidth: 96,
            canvasHeight: 96,
            animations: Object.fromEntries(
              DESKTOP_PET_ACTIONS.map((action, row) => [
                action,
                {
                  src: 'pet.svg',
                  frameWidth: 96,
                  frameHeight: 96,
                  frameCount: 2,
                  fps: 6,
                  loop: true,
                  offsetX: 0,
                  offsetY: row * 96,
                },
              ]),
            ),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      const result = await validateDesktopPetPackage(root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issue.details?.some((detail) => detail.includes('manifest needs'))).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
