import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runExec } from '../../infra/exec.js';
import {
  SNAPSHOT_CHUNK_BYTES,
  SnapshotArtifactStore,
} from '../snapshot-artifact-store.js';

describe('SnapshotArtifactStore', () => {
  let root: string;
  let source: string;
  let target: string;
  let baseSha: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'xopc-snapshot-artifact-'));
    source = join(root, 'source');
    target = join(root, 'target');
    await mkdir(source, { recursive: true });
    await runExec('git', ['init', '-b', 'main'], { cwd: source });
    writeFileSync(join(source, '.gitignore'), 'ignored.tmp\n');
    writeFileSync(join(source, 'README.md'), 'baseline\n');
    writeFileSync(join(source, 'delete.txt'), 'delete me\n');
    writeFileSync(join(source, 'script.sh'), '#!/bin/sh\necho baseline\n');
    chmodSync(join(source, 'script.sh'), 0o755);
    await runExec('git', ['add', '.'], { cwd: source });
    await runExec('git', ['-c', 'user.name=xopc test', '-c', 'user.email=xopc@example.test', 'commit', '-m', 'baseline'], { cwd: source });
    baseSha = (await runExec('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
    await runExec('git', ['worktree', 'add', '--detach', target, baseSha], { cwd: source });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips modified, deleted, binary, executable, and symlink state', async () => {
    writeFileSync(join(source, 'README.md'), 'modified\n');
    rmSync(join(source, 'delete.txt'));
    writeFileSync(join(source, 'binary.dat'), Buffer.from([0, 255, 1, 2]));
    writeFileSync(join(source, 'script.sh'), '#!/bin/sh\necho changed\n');
    chmodSync(join(source, 'script.sh'), 0o755);
    symlinkSync('README.md', join(source, 'readme-link'));
    writeFileSync(join(source, 'ignored.tmp'), 'do not transfer\n');

    const sourceStore = new SnapshotArtifactStore(join(root, 'source-state'));
    const artifact = await sourceStore.create({ artifactId: 'artifact-1', rootPath: source, baseSha });
    const receivingStore = new SnapshotArtifactStore(join(root, 'receiving-state'));
    await receivingStore.beginReceive(artifact);
    let offset = 0;
    while (offset < artifact.size) {
      const chunk = await sourceStore.readChunk(artifact.artifactId, offset, SNAPSHOT_CHUNK_BYTES);
      await receivingStore.writeChunk(artifact.artifactId, offset, chunk.data);
      offset += chunk.data.length;
    }
    await receivingStore.finalizeReceive(artifact.artifactId);
    expect(await receivingStore.beginReceive(artifact)).toBe(true);
    await receivingStore.apply({ artifactId: artifact.artifactId, rootPath: target, baseSha });

    expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('modified\n');
    expect(readFileSync(join(target, 'binary.dat'))).toEqual(Buffer.from([0, 255, 1, 2]));
    expect(existsSync(join(target, 'delete.txt'))).toBe(false);
    expect(existsSync(join(target, 'ignored.tmp'))).toBe(false);
    expect(lstatSync(join(target, 'readme-link')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(target, 'script.sh')).mode & 0o111).toBe(0o111);
    const sourceStatus = (await runExec('git', ['status', '--porcelain=v1'], { cwd: source })).stdout;
    const targetStatus = (await runExec('git', ['status', '--porcelain=v1'], { cwd: target })).stdout;
    expect(targetStatus).toBe(sourceStatus);
  });
});
