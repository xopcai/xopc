import { DatabaseSync } from 'node:sqlite';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createStateBackup, restoreStateBackup, verifyStateBackup } from '../archive.js';

const roots: string[] = [];

async function fixture(): Promise<{ root: string; state: string; archive: string; restored: string }> {
  const root = await mkdtemp(join(tmpdir(), 'xopc-backup-test-'));
  roots.push(root);
  const state = join(root, 'state');
  await mkdir(join(state, 'agents', 'main', 'profile'), { recursive: true });
  await writeFile(join(state, 'xopc.json'), '{"gateway":{}}');
  await writeFile(join(state, 'agents', 'main', 'profile', 'SOUL.md'), 'Private profile');
  const db = new DatabaseSync(join(state, 'xopc.db'));
  db.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO schema_meta VALUES('schema_version','228'); CREATE TABLE conversations(content TEXT); INSERT INTO conversations VALUES('private chat');");
  db.close();
  return { root, state, archive: join(root, 'archive'), restored: join(root, 'restored') };
}

afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('encrypted offline state backup', () => {
  it('creates, verifies and restores database and files without plaintext in the archive', async () => {
    const { state, archive, restored } = await fixture();
    const manifest = await createStateBackup({ stateDir: state, output: archive, passphrase: 'a long test passphrase' });
    expect(manifest.entries.map((entry) => entry.path)).toContain('xopc.db');
    expect(manifest.entries.map((entry) => entry.path)).toContain('agents/main/profile/SOUL.md');
    expect((await stat(archive)).mode & 0o777).toBe(0o700);
    await expect(verifyStateBackup(archive, 'wrong passphrase')).rejects.toThrow();
    await expect(verifyStateBackup(archive, 'a long test passphrase')).resolves.toMatchObject({ schemaVersion: 228 });
    await restoreStateBackup({ archivePath: archive, target: restored, passphrase: 'a long test passphrase' });
    expect(await readFile(join(restored, 'agents/main/profile/SOUL.md'), 'utf8')).toBe('Private profile');
    const db = new DatabaseSync(join(restored, 'xopc.db'), { readOnly: true });
    try { expect((db.prepare('SELECT content FROM conversations').get() as { content: string }).content).toBe('private chat'); }
    finally { db.close(); }
    const blobNames = await readdir(join(archive, 'blobs'));
    for (const blob of blobNames) expect((await readFile(join(archive, 'blobs', blob))).includes(Buffer.from('private chat'))).toBe(false);
  });

  it('rejects corruption and does not publish a partial restore', async () => {
    const { root, state, archive, restored } = await fixture();
    const manifest = await createStateBackup({ stateDir: state, output: archive, passphrase: 'a long test passphrase' });
    const blob = join(archive, 'blobs', manifest.entries[0]!.blob);
    await writeFile(blob, 'corrupt');
    await expect(verifyStateBackup(archive, 'a long test passphrase')).rejects.toThrow();
    await expect(restoreStateBackup({ archivePath: archive, target: restored, passphrase: 'a long test passphrase' })).rejects.toThrow();
    expect(await readdir(root)).not.toContain('restored');
  });

  it('refuses a backup that would omit an external workspace', async () => {
    const { root, state, archive } = await fixture();
    await expect(createStateBackup({ stateDir: state, output: archive, passphrase: 'a long test passphrase', configuredPaths: [join(root, 'external-workspace')] }))
      .rejects.toThrow('External paths are not included');
    expect(await readdir(root)).not.toContain('archive');
  });

  it('detects an external workspace in legacy config before writing an archive', async () => {
    const { root, state, archive } = await fixture();
    await writeFile(join(state, 'xopc.json'), JSON.stringify({ agents: { list: [{ id: 'main', workspace: join(root, 'outside') }] } }));
    await expect(createStateBackup({ stateDir: state, output: archive, passphrase: 'a long test passphrase' }))
      .rejects.toThrow('External paths are not included');
  });

  it.skipIf(process.platform === 'win32')('rejects symlinks that could escape the state directory', async () => {
    const { root, state, archive } = await fixture();
    const outside = join(root, 'outside-secret');
    await writeFile(outside, 'do not include');
    await symlink(outside, join(state, 'linked-secret'));
    await expect(createStateBackup({ stateDir: state, output: archive, passphrase: 'a long test passphrase' }))
      .rejects.toThrow('symbolic link');
  });

  it('runs the backup CLI without bootstrapping or migrating the source database', async () => {
    const { root, state, archive } = await fixture();
    const passphrase = join(root, 'passphrase');
    await writeFile(passphrase, 'a long test passphrase\n');
    await chmod(passphrase, 0o600);
    const output = execFileSync(join(process.cwd(), 'node_modules/.bin/tsx'), [
      'src/cli/bin.ts', 'backup', 'create', '--output', archive, '--passphrase-file', passphrase,
    ], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: join(state, 'xopc.json'), XOPC_WORKSPACE: join(state, 'workspace') } });
    expect(output).toContain('Backup created');
    await expect(verifyStateBackup(archive, 'a long test passphrase')).resolves.toMatchObject({ schemaVersion: 228 });
  });
});
import { execFileSync } from 'node:child_process';
