import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createBrowserNativeBootstrap,
  decodeNativeMessage,
  encodeNativeMessage,
} from '../native-messaging-host.js';

describe('browser native messaging framing', () => {
  const temporaryDirectories: string[] = [];
  const originalStateDir = process.env.XOPC_STATE_DIR;

  afterEach(() => {
    if (originalStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = originalStateDir;
    temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  });

  it('round trips a Chrome native message', () => {
    const message = { type: 'bootstrap', nonce: 'test' };
    expect(decodeNativeMessage(encodeNativeMessage(message))).toEqual(message);
  });

  it('rejects truncated and oversized frames', () => {
    expect(() => decodeNativeMessage(Buffer.alloc(3))).toThrow(/header/i);
    const invalid = Buffer.alloc(4);
    invalid.writeUInt32LE(1024 * 1024 + 1);
    expect(() => decodeNativeMessage(invalid)).toThrow(/length/i);
  });

  it('creates a short-lived v3 pairing link for the configured loopback Gateway', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-browser-native-'));
    temporaryDirectories.push(directory);
    const configPath = join(directory, 'xopc.json');
    writeFileSync(configPath, JSON.stringify({ gateway: { port: 18888 } }));
    process.env.XOPC_STATE_DIR = directory;

    const result = createBrowserNativeBootstrap(configPath);
    const payload = JSON.parse(Buffer.from(new URL(result.pairingLink).hash.slice(3), 'base64url').toString('utf8')) as {
      version: number;
      routes: Array<{ kind: string; url: string }>;
      expiresAt: number;
    };
    expect(result.gatewayUrl).toBe('http://127.0.0.1:18888');
    expect(payload).toMatchObject({
      version: 3,
      routes: [{ kind: 'local-browser', url: 'http://127.0.0.1:18888' }],
    });
    expect(payload.expiresAt).toBeGreaterThan(Date.now());
  });
});
