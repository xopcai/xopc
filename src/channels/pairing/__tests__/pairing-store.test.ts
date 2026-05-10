import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { approvePairingCodeSync, upsertPairingRequestSync } from '../pairing-store.js';

describe('pairing-store', () => {
  let dir: string;
  let pairingPath: string;
  let allowPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xopc-pair-'));
    pairingPath = path.join(dir, 'pairing.json');
    allowPath = path.join(dir, 'allow.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('upsert mints a code then approve adds id to allowFrom file', () => {
    const u = upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: 'user-1',
      accountId: 'default',
    });
    expect(u.created).toBe(true);
    expect(u.code?.length).toBe(8);

    const approved = approvePairingCodeSync({
      pairingFilePath: pairingPath,
      allowFromFilePath: allowPath,
      code: u.code!,
      accountId: 'default',
    });
    expect(approved?.senderId).toBe('user-1');

    const raw = JSON.parse(fs.readFileSync(allowPath, 'utf-8')) as { allowFrom: string[] };
    expect(raw.allowFrom).toContain('user-1');
  });
});
