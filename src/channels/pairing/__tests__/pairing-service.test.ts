import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENV_VARS } from '../../../config/paths-state.js';
import { approveChannelPairing, approveChannelPairingBySender, dismissChannelPairingPending, listChannelPairingState, listChannelPairingSummary, revokeChannelPairingPaired, collectPairingPendingIssues } from '../pairing-service.js';
import { upsertPairingRequestSync } from '../pairing-store.js';

describe('pairing-service', () => {
  let dir: string;
  let prevCredDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xopc-pair-svc-'));
    prevCredDir = process.env[ENV_VARS.CREDENTIALS_DIR];
    process.env[ENV_VARS.CREDENTIALS_DIR] = dir;
  });

  afterEach(() => {
    if (prevCredDir === undefined) delete process.env[ENV_VARS.CREDENTIALS_DIR];
    else process.env[ENV_VARS.CREDENTIALS_DIR] = prevCredDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists pending and paired state for telegram', () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '916534770',
      accountId: 'default',
    });

    const state = listChannelPairingState({
      channel: 'telegram',
      accountId: 'default',
      config: {
        channels: {
          telegram: {
            enabled: true,
            dmPolicy: 'pairing',
            allowFrom: ['111'],
          },
        },
      } as any,
    });

    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]?.senderId).toBe('916534770');
    expect(state.pending[0]?.codeLast4).toHaveLength(4);
    expect(state.paired.fromConfig).toEqual(['111']);
    expect(state.paired.fromCredentials).toEqual([]);
    expect(state.dmPolicy).toBe('pairing');
  });

  it('approves pairing code via service', () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    const allowPath = path.join(dir, 'xopc-telegram-default-allowFrom.json');
    const u = upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '916534770',
      accountId: 'default',
    });

    const approved = approveChannelPairing({
      channel: 'telegram',
      accountId: 'default',
      code: u.code!,
    });
    expect(approved.ok).toBe(true);
    if (approved.ok === false) return;
    expect(approved.senderId).toBe('916534770');

    const raw = JSON.parse(fs.readFileSync(allowPath, 'utf-8')) as { allowFrom: string[] };
    expect(raw.allowFrom).toContain('916534770');

    const state = listChannelPairingState({ channel: 'telegram', accountId: 'default' });
    expect(state.pending).toHaveLength(0);
    expect(state.paired.fromCredentials).toContain('916534770');
  });

  it('returns error for invalid code', () => {
    const result = approveChannelPairing({
      channel: 'telegram',
      accountId: 'default',
      code: 'NOTVALID',
    });
    expect(result.ok).toBe(false);
  });

  it('revokes paired sender from credential store', () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    const allowPath = path.join(dir, 'xopc-telegram-default-allowFrom.json');
    const u = upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '916534770',
      accountId: 'default',
    });
    approveChannelPairing({ channel: 'telegram', accountId: 'default', code: u.code! });

    const revoked = revokeChannelPairingPaired({
      channel: 'telegram',
      accountId: 'default',
      senderId: '916534770',
    });
    expect(revoked.ok).toBe(true);
    if (revoked.ok === false) return;
    expect(revoked.changed).toBe(true);

    const raw = JSON.parse(fs.readFileSync(allowPath, 'utf-8')) as { allowFrom: string[] };
    expect(raw.allowFrom).not.toContain('916534770');
  });

  it('summarizes pending counts across accounts', () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '111',
      accountId: 'default',
    });
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '222',
      accountId: 'default',
    });

    const summary = listChannelPairingSummary({
      channels: {
        telegram: { enabled: true, dmPolicy: 'pairing', accounts: { default: {} } },
      },
    } as any);
    expect(summary.telegram.pending).toBe(2);
    expect(summary.telegram.stale).toBe(0);
    expect(summary.feishu.pending).toBe(0);
  });

  it('approves pending request by sender id', () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '916534770',
      accountId: 'default',
    });

    const approved = approveChannelPairingBySender({
      channel: 'telegram',
      accountId: 'default',
      senderId: '916534770',
    });
    expect(approved.ok).toBe(true);
    if (approved.ok === false) return;
    expect(approved.senderId).toBe('916534770');
  });

  it('collects pairing pending issues for doctor', () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '333',
      accountId: 'default',
    });
    const issues = collectPairingPendingIssues({
      channels: {
        telegram: { enabled: true, dmPolicy: 'pairing', accounts: { default: {} } },
      },
    } as any);
    expect(issues.some((i) => i.channel === 'telegram' && i.pending === 1)).toBe(true);
  });

  it('ignores pending when channel is disabled', () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '444',
      accountId: 'default',
    });

    const summary = listChannelPairingSummary({
      channels: {
        telegram: { enabled: false, dmPolicy: 'pairing', accounts: { default: {} } },
      },
    } as any);
    expect(summary.telegram.pending).toBe(0);

    const issues = collectPairingPendingIssues({
      channels: {
        telegram: { enabled: false, dmPolicy: 'pairing', accounts: { default: {} } },
      },
    } as any);
    expect(issues).toHaveLength(0);
  });

  it('counts pending when account-level dmPolicy is pairing', () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '555',
      accountId: 'default',
    });

    const summary = listChannelPairingSummary({
      channels: {
        telegram: {
          enabled: true,
          dmPolicy: 'allowlist',
          accounts: { default: { dmPolicy: 'pairing' } },
        },
      },
    } as any);
    expect(summary.telegram.pending).toBe(1);
  });

  it('ignores pending for disabled account', () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '666',
      accountId: 'default',
    });

    const summary = listChannelPairingSummary({
      channels: {
        telegram: {
          enabled: true,
          dmPolicy: 'pairing',
          accounts: { default: { enabled: false } },
        },
      },
    } as any);
    expect(summary.telegram.pending).toBe(0);
  });

  it('dismisses pending request without adding to allowFrom', () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    const allowPath = path.join(dir, 'xopc-telegram-default-allowFrom.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '777',
      accountId: 'default',
    });

    const dismissed = dismissChannelPairingPending({
      channel: 'telegram',
      accountId: 'default',
      senderId: '777',
    });
    expect(dismissed.ok).toBe(true);
    if (dismissed.ok === false) return;
    expect(dismissed.senderId).toBe('777');

    const state = listChannelPairingState({ channel: 'telegram', accountId: 'default' });
    expect(state.pending).toHaveLength(0);
    expect(fs.existsSync(allowPath)).toBe(false);
  });
});
