import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { expect, it } from 'vitest';

import { DesktopGatewaySettings, normalizeGatewayOrigin } from '../gateway/desktop-settings.js';

it('persists the selected backend with encrypted credentials and retains each server identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-desktop-settings-'));
  const key = randomBytes(32), iv = randomBytes(16);
  const settings = new DesktopGatewaySettings(join(root, 'gateway.json'), {
    encrypt: async text => { const cipher = createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([cipher.update(text), cipher.final()]); },
    decrypt: async bytes => { const cipher = createDecipheriv('aes-256-cbc', key, iv); return Buffer.concat([cipher.update(bytes), cipher.final()]).toString(); },
  });
  try {
    expect(await settings.read()).toEqual({ mode: 'local' });
    const configured = await settings.configure('https://gateway.example', 'secret-owner-token');
    await settings.write(configured);
    expect(await readFile(join(root, 'gateway.json'), 'utf8')).not.toContain('secret-owner-token');
    expect(await settings.remote(await settings.read())).toEqual({ origin: 'https://gateway.example', token: 'secret-owner-token' });
    const preserved = await settings.configure('https://gateway.example');
    expect(preserved.remote?.encryptedCredential).toBe(configured.remote?.encryptedCredential);
    await expect(settings.configure('https://other.example')).rejects.toThrow('Enter the Gateway access token');
    expect((await settings.read()).remote?.origin).toBe('https://gateway.example');
    await settings.write({ ...configured, mode: 'local' });
    expect((await settings.read()).mode).toBe('local');
    expect(await settings.remote(await settings.read())).toHaveProperty('token', 'secret-owner-token');
  } finally { await rm(root, { recursive: true, force: true }); }
});
it.each(['http://public.example', 'https://a.example/path', 'https://user:secret@a.example', 'https://a.example/?token=secret'])('rejects unsafe or ambiguous destinations: %s', input => {
  expect(() => normalizeGatewayOrigin(input)).toThrow();
});
