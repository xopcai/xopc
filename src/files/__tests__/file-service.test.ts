import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FileServiceError,
  fileResourceId,
  fileResourceFromPath,
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

  it.each(['.env', '.env.local', 'deploy.sh', 'Dockerfile', 'Dockerfile.dev', 'app.py', 'config.toml', 'Cargo.lock'])(
    'marks common source file %s as previewable and editable',
    async (name) => {
      const root = await mkdtemp(join(tmpdir(), 'xopc-files-text-'));
      const path = join(root, name);
      await writeFile(path, 'plain text');
      const resource = await fileResourceFromPath({
        id: 'space-one', title: 'test', kind: 'workspace', bindings: [], writable: true, root,
      }, await realpath(path));
      expect(resource.mimeType).not.toBe('application/octet-stream');
      expect(resource.capabilities).toEqual(expect.arrayContaining(['preview', 'edit']));
    },
  );

  it('sniffs unfamiliar text files without exposing binary files to the editor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-files-sniff-'));
    const textPath = join(root, 'notes.custom');
    const binaryPath = join(root, 'payload.custom');
    await writeFile(textPath, 'editable text\n');
    await writeFile(binaryPath, Buffer.from([0x50, 0x4b, 0x00, 0x03, 0x04]));
    const space = { id: 'space-one', title: 'test', kind: 'workspace' as const, bindings: [], writable: true, root };

    const text = await fileResourceFromPath(space, await realpath(textPath));
    const binary = await fileResourceFromPath(space, await realpath(binaryPath));

    expect(text).toMatchObject({ mimeType: 'text/plain' });
    expect(text.capabilities).toEqual(expect.arrayContaining(['preview', 'edit']));
    expect(binary).toMatchObject({ mimeType: 'application/octet-stream' });
    expect(binary.capabilities).not.toContain('edit');
  });
});
