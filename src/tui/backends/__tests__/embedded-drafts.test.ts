import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { TuiDraftFileStore } from '../embedded-drafts.js';

it('persists text and inline attachments privately, isolates scopes and reclaims cleared records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-composer-test-'));
  try {
    const scope = join(directory, 'one');
    const first = new TuiDraftFileStore(scope);
    const second = new TuiDraftFileStore(join(directory, 'two'));
    const id = randomUUID();
    const snapshot = { text: 'unsent', attachments: [{ type: 'image', data: 'aGVsbG8=' }] };
    first.save(id, snapshot);
    expect(new TuiDraftFileStore(scope).read(id)).toEqual(snapshot);
    expect(second.read(id)).toBeUndefined();
    expect(statSync(join(scope, `${id}.json`)).mode & 0o777).toBe(0o600);
    expect(readdirSync(scope)).toEqual([`${id}.json`]);
    first.remove(id);
    expect(readdirSync(scope)).toEqual([]);
    expect(first.read(id)).toBeUndefined();
    expect(() => first.save('../escape', snapshot)).toThrow('UUID');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
