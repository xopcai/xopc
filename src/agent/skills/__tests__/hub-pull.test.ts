import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { classifyHubSource, findSkillRoot } from '../hub-pull.js';

describe('classifyHubSource', () => {
  it('treats https zip as archive', () => {
    expect(classifyHubSource('https://example.com/a.zip')).toBe('archive');
  });

  it('treats tarball URLs as archive', () => {
    expect(classifyHubSource('https://x.org/skill.tar.gz')).toBe('archive');
    expect(classifyHubSource('https://x.org/skill.tgz')).toBe('archive');
  });

  it('treats git-style URLs as git', () => {
    expect(classifyHubSource('https://github.com/org/repo.git')).toBe('git');
    expect(classifyHubSource('git@github.com:org/repo.git')).toBe('git');
  });
});

describe('findSkillRoot', () => {
  it('finds SKILL.md at root', () => {
    const root = join(tmpdir(), `xopc-find-skill-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'SKILL.md'), '---\nname: t\ndescription: d\n---\n');
    try {
      expect(findSkillRoot(root)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds SKILL.md in single child folder', () => {
    const root = join(tmpdir(), `xopc-find-skill-nested-${Date.now()}`);
    mkdirSync(join(root, 'pkg'), { recursive: true });
    writeFileSync(join(root, 'pkg', 'SKILL.md'), '---\nname: t\ndescription: d\n---\n');
    try {
      expect(findSkillRoot(root)).toBe(join(root, 'pkg'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('respects subpath', () => {
    const base = join(tmpdir(), `xopc-sub-${Date.now()}`);
    mkdirSync(join(base, 'nested', 's'), { recursive: true });
    writeFileSync(join(base, 'nested', 's', 'SKILL.md'), '---\nname: t\ndescription: d\n---\n');
    try {
      expect(findSkillRoot(base, 'nested/s')).toBe(join(base, 'nested', 's'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
