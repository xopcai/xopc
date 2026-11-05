import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { FileProviderOperationJournal } from '../provider-operation-journal.js';

it('records before effects, refuses conflicting replay and reconciles persisted evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-provider-journal-'));
  try {
    const intent = { operationId: randomUUID(), providerDigest: 'a'.repeat(64), toolRevision: 'b'.repeat(64), argumentsDigest: 'c'.repeat(64) };
    const journal = new FileProviderOperationJournal(directory);
    expect(await journal.begin(intent)).toBe('started');
    expect((await journal.status(intent.operationId))?.state).toBe('running');
    const restarted = new FileProviderOperationJournal(directory);
    expect((await restarted.status(intent.operationId))?.state).toBe('unknown');
    expect(await restarted.begin(intent)).toBe('exists');
    await expect(restarted.begin({ ...intent, argumentsDigest: 'd'.repeat(64) })).rejects.toThrow('conflicts');
    await expect(journal.finish({ ...intent, toolRevision: 'd'.repeat(64) })).rejects.toThrow('intent');
    const receipt = await journal.finish(intent, 'e'.repeat(64));
    expect(await restarted.status(intent.operationId)).toEqual(receipt);
    expect(Object.keys(JSON.parse(readFileSync(join(directory, `${intent.operationId}.json`), 'utf8'))).sort())
      .toEqual(['intent', 'resultDigest', 'state', 'updatedAt']);
    expect(await restarted.begin(intent)).toBe('exists');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
