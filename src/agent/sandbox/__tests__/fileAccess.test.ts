import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertWorkspaceTreeReadable, readWorkspaceFile, writeWorkspaceFile } from '../fileAccess.js';
import { evaluateExecPolicy, evaluateFilePolicy } from '../exec-policy.js';
import { createListDirTool } from '../../tools/list-dir.js';
import { createSendMediaTool } from '../../tools/send-media.js';
import { createReviewWorkspaceTool } from '../../tools/review-workspace.js';
import { createReadFileTool } from '../../tools/read.js';
import { createWriteFileTool } from '../../tools/write.js';
import { createApplyPatchTool } from '../../tools/apply-patch.js';
import { createFindTool } from '../../tools/find.js';
import { createGrepTool } from '../../tools/grep.js';

describe('workspace file boundary', () => {
  let root: string;
  let workspace: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xopc-file-boundary-'));
    workspace = join(root, 'workspace');
    mkdirSync(workspace);
    writeFileSync(join(root, 'outside.txt'), 'outside');
    writeFileSync(join(workspace, 'inside.txt'), 'inside');
  });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

  it.each(['read', 'write', 'edit', 'delete'] as const)('rejects traversal and external absolute paths for %s', operation => {
    for (const path of ['../outside.txt', join(root, 'outside.txt')]) {
      expect(evaluateFilePolicy({ workspaceRoot: workspace, path, operation }).allowed).toBe(false);
    }
  });

  it('constrains exec cwd to the actual workspace', () => {
    expect(evaluateExecPolicy({ command: 'git status', cwd: root, workspaceRoot: workspace }).allowed).toBe(false);
    expect(evaluateExecPolicy({ command: 'git push --force origin main', cwd: workspace, workspaceRoot: workspace }).allowed).toBe(true);
  });

  it('rejects external and dangling symlinks before I/O', () => {
    symlinkSync(join(root, 'outside.txt'), join(workspace, 'escape'));
    symlinkSync(join(root, 'new.txt'), join(workspace, 'dangling'));
    expect(() => readWorkspaceFile(workspace, 'escape')).toThrow();
    expect(() => writeWorkspaceFile(workspace, 'escape', 'changed')).toThrow();
    expect(() => writeWorkspaceFile(workspace, 'dangling', 'changed')).toThrow();
    expect(readFileSync(join(root, 'outside.txt'), 'utf8')).toBe('outside');
    expect(() => readFileSync(join(root, 'new.txt'))).toThrow();
  });

  it.each(['.env', '.env.development', '.env.production.local', '.ssh/id_rsa', '.xopc/xopc.json', '.xopc/xopc.db'])('protects %s including aliases', path => {
    const target = join(workspace, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, 'secret');
    symlinkSync(target, join(workspace, 'alias'));
    for (const candidate of [path, 'alias']) {
      expect(() => readWorkspaceFile(workspace, candidate)).toThrow();
      expect(() => writeWorkspaceFile(workspace, candidate, 'changed')).toThrow();
    }
    expect(readFileSync(target, 'utf8')).toBe('secret');
  });

  it('protects a custom config path and its canonical target', () => {
    writeFileSync(join(workspace, 'settings.json'), 'secret');
    symlinkSync(join(workspace, 'settings.json'), join(workspace, 'config-link'));
    vi.stubEnv('XOPC_CONFIG_PATH', join(workspace, 'config-link'));
    expect(() => readWorkspaceFile(workspace, 'settings.json')).toThrow();
    expect(() => writeWorkspaceFile(workspace, 'settings.json', 'changed')).toThrow();
  });

  it('protects custom SQLite state and sidecar files', () => {
    vi.stubEnv('XOPC_STATE_DIR', workspace);
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      writeFileSync(join(workspace, `xopc.db${suffix}`), 'synthetic-private-state');
      expect(() => readWorkspaceFile(workspace, `xopc.db${suffix}`)).toThrow();
    }
  });

  it('rejects hard-linked files without truncating the original', () => {
    linkSync(join(root, 'outside.txt'), join(workspace, 'hardlink'));
    expect(() => readWorkspaceFile(workspace, 'hardlink')).toThrow('hard links');
    expect(() => writeWorkspaceFile(workspace, 'hardlink', 'changed')).toThrow('hard links');
    expect(readFileSync(join(root, 'outside.txt'), 'utf8')).toBe('outside');
  });

  it('preserves safe internal symlinks and creates nested files', () => {
    symlinkSync(join(workspace, 'inside.txt'), join(workspace, 'alias'));
    expect(readWorkspaceFile(workspace, 'alias').toString()).toBe('inside');
    writeWorkspaceFile(workspace, 'alias', 'updated');
    expect(readWorkspaceFile(workspace, 'inside.txt').toString()).toBe('updated');
    writeWorkspaceFile(workspace, 'a/b/new.txt', 'new');
    expect(readWorkspaceFile(workspace, 'a/b/new.txt').toString()).toBe('new');
    expect(() => readWorkspaceFile(workspace, 'inside.txt', 2)).toThrow('too large');
  });

  it('enforces the boundary in real file and patch tools', async () => {
    const read = await createReadFileTool(workspace).execute('read', { path: '../outside.txt' });
    expect(read.details).toMatchObject({ status: 'failed' });
    const write = await createWriteFileTool(workspace).execute('write', { path: '../outside.txt', content: 'changed' });
    expect(write.details).toMatchObject({ status: 'failed' });
    await expect(createApplyPatchTool(workspace).execute('patch', {
      patch: '*** Begin Patch\n*** Delete File: ../outside.txt\n*** End Patch',
    })).rejects.toThrow('outside allowed roots');
    expect(readFileSync(join(root, 'outside.txt'), 'utf8')).toBe('outside');
  });

  it('rejects directory and media access outside the workspace', async () => {
    const list = await createListDirTool(workspace).execute('list', { path: '..' });
    expect(JSON.stringify(list.content)).toContain('outside allowed roots');
    const publishOutbound = vi.fn();
    const tool = createSendMediaTool(workspace, { publishOutbound } as any, () => ({ channel: 'telegram', chatId: 'fixture' }));
    const sent = await tool.execute('media', { filePath: '../outside.txt' });
    expect(sent.details).toHaveProperty('error');
    expect(publishOutbound).not.toHaveBeenCalled();
  });

  it('refuses publishing a directory containing credentials or external links', () => {
    mkdirSync(join(workspace, 'site'));
    writeFileSync(join(workspace, 'site/.env'), 'secret');
    expect(() => assertWorkspaceTreeReadable(workspace, 'site')).toThrow();
    rmSync(join(workspace, 'site/.env'));
    symlinkSync(join(root, 'outside.txt'), join(workspace, 'site/alias'));
    expect(() => assertWorkspaceTreeReadable(workspace, 'site')).toThrow();
  });

  it('excludes both tracked and untracked credentials from workspace reviews', async () => {
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    writeFileSync(join(workspace, '.env.tracked'), 'tracked-secret-value');
    writeFileSync(join(workspace, '.env.untracked'), 'untracked-secret-value');
    execFileSync('git', ['add', '.env.tracked', 'inside.txt'], { cwd: workspace });
    const reviewed = await createReviewWorkspaceTool(workspace).execute('review', {});
    const text = JSON.stringify(reviewed.content);
    expect(text).toContain('inside');
    expect(text).not.toContain('tracked-secret-value');
    expect(reviewed.details.complete).toBe(false);
  });

  it('allows only bare profile names to use the separate profile root', async () => {
    const profile = join(root, 'profile');
    mkdirSync(profile);
    writeFileSync(join(profile, 'SOUL.md'), 'profile');
    const read = createReadFileTool(workspace, { profileMarkdownRoot: profile });
    expect((await read.execute('read', { path: 'SOUL.md' })).content).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'profile' })]));
    expect((await read.execute('read', { path: '../profile/SOUL.md' })).details).toMatchObject({ status: 'failed' });
    const write = createWriteFileTool(workspace, { profileMarkdownRoot: profile });
    await write.execute('write', { path: 'SOUL.md', content: 'updated' });
    expect(readFileSync(join(profile, 'SOUL.md'), 'utf8')).toBe('updated');
    expect((await write.execute('write', { path: '../profile/SOUL.md', content: 'bad' })).details).toMatchObject({ status: 'failed' });
  });

  it('keeps sensitive files out of search even with a broad user glob', async () => {
    writeFileSync(join(workspace, '.env'), 'unique_secret');
    mkdirSync(join(workspace, '.ssh'));
    writeFileSync(join(workspace, '.ssh/key'), 'unique_secret');
    writeFileSync(join(root, 'outside.txt'), 'unique_secret');
    linkSync(join(root, 'outside.txt'), join(workspace, 'linked-secret'));
    const grep = createGrepTool(workspace);
    const result = await grep.execute('grep', { pattern: 'unique_secret', glob: '**/*' });
    expect(JSON.stringify(result.content)).not.toContain('unique_secret');
    const found = await createFindTool(workspace).execute('find', { pattern: '**/*' });
    expect(JSON.stringify(found.content)).not.toContain('.env');
    expect(JSON.stringify(found.content)).not.toContain('.ssh');
    await expect(grep.execute('grep', { path: '..', pattern: 'outside' })).rejects.toThrow('outside allowed roots');
  });
});
