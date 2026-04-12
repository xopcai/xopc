import { existsSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { lockPath } = vi.hoisted(() => {
  const { join } = require('node:path') as typeof import('node:path');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  return { lockPath: join(tmpdir(), `xopc-skills-lock-test-${process.pid}.json`) };
});

vi.mock('../../../config/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/paths.js')>();
  return {
    ...actual,
    resolveSkillsLockPath: () => lockPath,
  };
});

const { loadSkillsLock, saveSkillsLock, recordSkillsHubInstall, removeSkillsLockEntry, getSkillsLockEntry } =
  await import('../hub-lock.js');

describe('skills hub lock', () => {
  afterEach(() => {
    if (existsSync(lockPath)) {
      rmSync(lockPath, { force: true });
    }
  });

  it('roundtrips empty lock', () => {
    saveSkillsLock({ version: 1, entries: {} });
    const l = loadSkillsLock();
    expect(l.version).toBe(1);
    expect(Object.keys(l.entries)).toHaveLength(0);
  });

  it('records install and removes entry', () => {
    recordSkillsHubInstall(
      'my-skill',
      { kind: 'git', source: 'https://github.com/a/b.git', ref: 'main' },
      'abc123',
    );
    const e = getSkillsLockEntry('my-skill');
    expect(e?.kind).toBe('git');
    expect(e?.source).toContain('github.com');
    expect(e?.contentHash).toBe('abc123');
    removeSkillsLockEntry('my-skill');
    expect(getSkillsLockEntry('my-skill')).toBeUndefined();
  });

  it('preserves installedAt on update', () => {
    recordSkillsHubInstall('s', { kind: 'archive', source: 'https://x/a.zip' }, 'h1');
    const first = getSkillsLockEntry('s');
    recordSkillsHubInstall('s', { kind: 'archive', source: 'https://x/a.zip' }, 'h2');
    const second = getSkillsLockEntry('s');
    expect(second?.installedAt).toBe(first?.installedAt);
    expect(second?.contentHash).toBe('h2');
    expect(second?.updatedAt).toBeDefined();
  });
});
