import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionInputCoordinator } from '../src/gateway/service/session-input-coordinator.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';

const dir = await mkdtemp(join(tmpdir(), 'xopc-personal-idle-input-'));
const samples: number[] = [];
let resolveClaim: () => void = () => {};
let startedAt = 0;
try {
  openXopcDatabase({ path: join(dir, 'xopc.db') });
  const coordinator = new SessionInputCoordinator({
    prioritizeInput: () => true,
    sessionExists: async () => true,
    prepareAttachments: async (_id, attachments) => attachments,
    prepareContexts: async () => [],
    steer: async () => false,
    emit: () => {},
    execute: async () => {
      samples.push(performance.now() - startedAt);
      resolveClaim();
      return { status: 'ok', summary: '' };
    },
  });
  for (let i = 0; i < 22; i++) {
    const conversationId = randomUUID();
    const clientMessageId = randomUUID();
    const claim = new Promise<void>(resolve => { resolveClaim = resolve; });
    startedAt = performance.now();
    const accepted = await coordinator.submit({
      conversationId, clientMessageId, delivery: 'next', content: 'Summarize the local fixture.',
      origin: { type: 'system', source: 'cli' },
    });
    assert.equal(accepted.ok, true);
    await claim;
    await coordinator.waitForCompletion(conversationId, clientMessageId);
  }
  const sorted = samples.slice(2).sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil(p * sorted.length) - 1];
  console.log(JSON.stringify({ scenario: 'idle Personal priority input, SQLite coordinator, synthetic execution',
    count: sorted.length, p50Ms: percentile(.5), p75Ms: percentile(.75), p95Ms: percentile(.95) }, null, 2));
} finally {
  closeXopcDatabase();
  await rm(dir, { recursive: true, force: true });
}
