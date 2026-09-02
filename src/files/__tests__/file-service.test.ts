import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FileServiceError,
  fileResourceId,
  parseFileResourceId,
  resolveFilePath,
} from '../file-service.js';

describe('file service paths', () => {
  it('round-trips opaque resource ids', () => {
    const id = fileResourceId('space-one', 'docs/a file.md');
    expect(parseFileResourceId(id)).toEqual({ spaceId: 'space-one', relativePath: 'docs/a file.md' });
  });

  it('allows dots inside file names but rejects traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-files-'));
    await writeFile(join(root, 'draft..final.md'), 'ok');
    expect(await resolveFilePath(root, 'draft..final.md')).toBe(await realpath(join(root, 'draft..final.md')));
    await expect(resolveFilePath(root, '../secret')).rejects.toBeInstanceOf(FileServiceError);
  });

  it('rejects symlinks that escape the space', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-files-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'xopc-files-outside-'));
    await mkdir(join(root, 'docs'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(root, 'docs', 'secret.txt'));
    await expect(resolveFilePath(root, 'docs/secret.txt')).rejects.toMatchObject({ status: 400 });
  });
});
