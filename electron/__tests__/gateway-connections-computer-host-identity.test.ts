import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import { computerHostBundleId } from '../desktop/computer-host-identity.js';

it('keeps development identity explicit and does not guess an installed identity on unsupported platforms', async () => {
  expect(await computerHostBundleId({ packaged: false, resourcesPath: '/missing' })).toBe('com.github.Electron');
  await expect(computerHostBundleId({ packaged: true, resourcesPath: '/missing', platform: 'win32' })).rejects.toThrow('UNSUPPORTED');
});
it.skipIf(process.platform !== 'darwin')('reads signed package identity from XML or binary plist and refuses missing or malformed identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-computer-identity-')), resourcesPath = join(root, 'Resources'), path = join(root, 'Info.plist');
  try {
    await mkdir(resourcesPath);
    const writeIdentity = (identity: string) => writeFile(path, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identity}</string></dict></plist>`);
    await writeIdentity('ai.xopc.desktop-observation.acceptance');
    expect(await computerHostBundleId({ packaged: true, resourcesPath })).toBe('ai.xopc.desktop-observation.acceptance');
    await promisify(execFile)('/usr/bin/plutil', ['-convert', 'binary1', path]);
    expect(await computerHostBundleId({ packaged: true, resourcesPath })).toBe('ai.xopc.desktop-observation.acceptance');
    await writeIdentity('invalid/host');
    await expect(computerHostBundleId({ packaged: true, resourcesPath })).rejects.toThrow('IDENTITY_UNAVAILABLE');
    await rm(path);
    await expect(computerHostBundleId({ packaged: true, resourcesPath })).rejects.toThrow('IDENTITY_UNAVAILABLE');
  } finally { await rm(root, { recursive: true, force: true }); }
});
