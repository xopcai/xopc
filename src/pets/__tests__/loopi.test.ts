import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
vi.mock('../../config/paths-state.js', () => ({ resolveStateDir: () => state.root }));

import { defaultDesktopPetPrefs, listDesktopPets, readDesktopPetState, writeDesktopPetPrefs } from '../../../electron/desktop-pet/prefs.js';

describe('Loopi desktop pet catalog', () => {
  afterEach(async () => {
    if (state.root) await rm(state.root, { recursive: true, force: true });
  });

  it('offers only Loopi as the built-in pet, without generated sprite payloads', async () => {
    state.root = await mkdtemp(join(tmpdir(), 'xopc-loopi-'));
    const { pets, issues } = await listDesktopPets();
    expect(issues).toEqual([]);
    expect(pets.map((pet) => pet.id)).toEqual(['loopi']);
    expect(pets[0]).toMatchObject({ renderer: 'loopi', builtin: true });
    expect(pets[0]).not.toHaveProperty('animations');
    expect(defaultDesktopPetPrefs.selectedPetId).toBe('loopi');
  });

  it('resolves an unavailable selection to the current default without an id migration', async () => {
    state.root = await mkdtemp(join(tmpdir(), 'xopc-loopi-'));
    await writeDesktopPetPrefs({ ...defaultDesktopPetPrefs, selectedPetId: 'missing-pet' });
    const current = await readDesktopPetState(false);
    expect(current.prefs.selectedPetId).toBe('loopi');
    expect(current.prefs.enabled).toBe(false);
  });
});
