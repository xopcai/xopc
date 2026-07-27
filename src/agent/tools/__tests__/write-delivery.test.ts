import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createWriteFileTool } from '../write.js';

describe('write_file delivery', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns a first-class file delivery after writing', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-write-delivery-'));
    roots.push(workspace);
    const result = await createWriteFileTool(workspace).execute('write-1', {
      path: 'reports/result.md',
      content: '# Result',
    });

    expect(readFileSync(join(workspace, 'reports/result.md'), 'utf8')).toBe('# Result');
    expect(result.details).toMatchObject({
      size: 8,
      delivery: {
        operation: 'updated',
        primary: {
          kind: 'file',
          title: 'result.md',
        },
      },
    });
  });
});
