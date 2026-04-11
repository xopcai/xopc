import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';

import { resolveSkillReadablePath } from '../skill-view-path.js';
import type { Skill } from '../types.js';

function makeSkill(baseDir: string, name = 'demo'): Skill {
  const filePath = join(baseDir, 'SKILL.md');
  return {
    name,
    description: 'test',
    filePath,
    baseDir,
    source: 'workspace',
    disableModelInvocation: false,
    metadata: { name, description: 'test' },
    content: '',
  };
}

describe('resolveSkillReadablePath', () => {
  it('resolves default SKILL.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-'));
    writeFileSync(join(dir, 'SKILL.md'), 'body');
    const skill = makeSkill(dir);
    const r = resolveSkillReadablePath(skill, undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.absolutePath).toBe(realpathSync(join(dir, 'SKILL.md')));
  });

  it('allows references/ files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-'));
    writeFileSync(join(dir, 'SKILL.md'), 'x');
    mkdirSync(join(dir, 'references'));
    writeFileSync(join(dir, 'references', 'api.md'), 'api');
    const skill = makeSkill(dir);
    const r = resolveSkillReadablePath(skill, 'references/api.md');
    expect(r.ok).toBe(true);
  });

  it('rejects path traversal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-'));
    writeFileSync(join(dir, 'SKILL.md'), 'x');
    const skill = makeSkill(dir);
    expect(resolveSkillReadablePath(skill, 'references/../SKILL.md').ok).toBe(false);
  });

  it('rejects bare files at skill root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-'));
    writeFileSync(join(dir, 'SKILL.md'), 'x');
    writeFileSync(join(dir, 'other.md'), 'y');
    const skill = makeSkill(dir);
    expect(resolveSkillReadablePath(skill, 'other.md').ok).toBe(false);
  });
});
