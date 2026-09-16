import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const crypto = vi.hoisted(() => ({ available: true }));
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => crypto.available,
  encryptString: (text: string) => Buffer.from(`encrypted:${text}`),
  decryptString: (buffer: Buffer) => {
    const text = buffer.toString(); if (!text.startsWith('encrypted:')) throw new Error('invalid');
    return text.slice('encrypted:'.length);
  },
} }));
import { readFullControl, writeFullControl } from '../control-preferences.js';

const roots: string[] = [];
function path() { const root = mkdtempSync(join(tmpdir(), 'xopc-control-pref-')); roots.push(root); return join(root, 'consent'); }
afterEach(() => { crypto.available = true; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('defaults to confirmation and restores only encrypted local consent', () => {
  const file = path(); expect(readFullControl(file)).toBe(false);
  writeFullControl(file, true); expect(readFullControl(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).not.toContain('full-control');
  writeFullControl(file, false); expect(readFullControl(file)).toBe(false);
});
it('fails closed for corruption and an unavailable keychain', () => {
  const file = path(); writeFileSync(file, '{"fullControl":true}');
  expect(readFullControl(file)).toBe(false);
  crypto.available = false;
  expect(() => writeFullControl(file, true)).toThrow('keychain');
  expect(readFullControl(file)).toBe(false);
  expect(() => writeFullControl(file, false)).not.toThrow();
});
