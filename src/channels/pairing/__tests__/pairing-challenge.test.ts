import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ENV_VARS } from '../../../config/paths-state.js';
import { issuePairingChallenge } from '../pairing-challenge.js';
import * as pairingEvents from '../pairing-events.js';

describe('issuePairingChallenge', () => {
  let dir: string;
  let prevCredDir: string | undefined;
  const broadcastSpy = vi.spyOn(pairingEvents, 'broadcastPairingEvent');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xopc-pair-challenge-'));
    prevCredDir = process.env[ENV_VARS.CREDENTIALS_DIR];
    process.env[ENV_VARS.CREDENTIALS_DIR] = dir;
    broadcastSpy.mockClear();
  });

  afterEach(() => {
    if (prevCredDir === undefined) delete process.env[ENV_VARS.CREDENTIALS_DIR];
    else process.env[ENV_VARS.CREDENTIALS_DIR] = prevCredDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('broadcasts requested when a new pairing code is created', async () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    const sendPairingReply = vi.fn().mockResolvedValue(undefined);

    const result = await issuePairingChallenge({
      channel: 'telegram',
      pairingFilePath: pairingPath,
      accountId: 'default',
      senderId: '916534770',
      senderIdLine: '916534770',
      sendPairingReply,
    });

    expect(result.created).toBe(true);
    expect(result.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(broadcastSpy).toHaveBeenCalledWith('channels.pairing.requested', {
      channel: 'telegram',
      accountId: 'default',
      senderId: '916534770',
    });
    expect(sendPairingReply).toHaveBeenCalledOnce();
  });

  it('broadcasts refreshed when an existing pending request is touched', async () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    const sendPairingReply = vi.fn().mockResolvedValue(undefined);

    await issuePairingChallenge({
      channel: 'telegram',
      pairingFilePath: pairingPath,
      accountId: 'default',
      senderId: '916534770',
      senderIdLine: '916534770',
      sendPairingReply,
    });
    broadcastSpy.mockClear();
    sendPairingReply.mockClear();

    const result = await issuePairingChallenge({
      channel: 'telegram',
      pairingFilePath: pairingPath,
      accountId: 'default',
      senderId: '916534770',
      senderIdLine: '916534770',
      sendPairingReply,
    });

    expect(result.created).toBe(false);
    expect(result.code).toBeTruthy();
    expect(broadcastSpy).toHaveBeenCalledWith('channels.pairing.refreshed', {
      channel: 'telegram',
      accountId: 'default',
      senderId: '916534770',
    });
    expect(sendPairingReply).not.toHaveBeenCalled();
  });
});
