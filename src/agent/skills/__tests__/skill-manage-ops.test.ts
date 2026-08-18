import { describe, expect, it } from 'vitest';

import {
  applyPatchToContent,
  ensureCategorySegment,
  effectiveAgentWritePolicy,
  resolveCreateSkillDir,
  mutatableSkillOrNull,
  validateSkillMdContent,
  validateSkillNameSegment,
  validateSupportingRelativePath,
} from '../skill-manage-ops.js';
import type { Skill } from '../types.js';

describe('validateSkillNameSegment', () => {
  it('rejects invalid', () => {
    expect(validateSkillNameSegment('Bad', 'name')).not.toBeNull();
    expect(validateSkillNameSegment('', 'name')).not.toBeNull();
  });
  it('accepts valid', () => {
    expect(validateSkillNameSegment('my-skill', 'name')).toBeNull();
  });
});

describe('validateSupportingRelativePath', () => {
  it('requires allowlisted root', () => {
    expect(validateSupportingRelativePath('evil.md')).not.toBeNull();
    expect(validateSupportingRelativePath('references/x.md')).toBeNull();
  });
  it('rejects traversal', () => {
    expect(validateSupportingRelativePath('references/../SKILL.md')).not.toBeNull();
  });
});

describe('validateSkillMdContent', () => {
  const good = `---
name: demo
description: A demo
---

# Body
`;

  it('accepts valid', () => {
    const r = validateSkillMdContent(good, 'demo', 100_000);
    expect(r.ok).toBe(true);
  });

  it('requires name match', () => {
    const r = validateSkillMdContent(good, 'other', 100_000);
    expect(r.ok).toBe(false);
  });
});

describe('applyPatchToContent', () => {
  it('replaces once', () => {
    const r = applyPatchToContent('hello world', 'world', 'there', false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('hello there');
  });

  it('replace_all', () => {
    const r = applyPatchToContent('a a a', 'a', 'b', true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('b b b');
  });
});

describe('ensureCategorySegment', () => {
  it('allows empty', () => {
    expect(ensureCategorySegment(undefined)).toBeNull();
  });
  it('rejects slash', () => {
    expect(ensureCategorySegment('a/b')).not.toBeNull();
  });
});

describe('skill manage write targets', () => {
  it('allows both global and workspace writes by default', () => {
    expect(effectiveAgentWritePolicy()).toBe('both');
  });

  it('resolves workspace create paths when requested', () => {
    const result = resolveCreateSkillDir('demo', undefined, 'workspace', 'C:/work/project', 'both');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dir.replace(/\\/g, '/')).toBe('C:/work/project/.xopc/skills/demo');
    }
  });

  it('rejects read-only external skill origins', () => {
    const skill = {
      name: 'external',
      baseDir: '/tmp/.agents/skills/external',
      source: 'global',
      origin: {
        id: 'agents-global',
        rootDir: '/tmp/.agents/skills',
        priority: 300,
        scope: 'global',
        managed: false,
        writable: false,
      },
    } as Skill;

    expect(mutatableSkillOrNull(skill, '/tmp/workspace', 'both')).toBeNull();
  });

  it('rejects read-only workspace agents skill origins', () => {
    const skill = {
      name: 'project-external',
      baseDir: '/tmp/workspace/.agents/skills/project-external',
      source: 'workspace',
      origin: {
        id: 'agents-workspace',
        rootDir: '/tmp/workspace/.agents/skills',
        priority: 450,
        scope: 'workspace',
        managed: false,
        writable: false,
      },
    } as Skill;

    expect(mutatableSkillOrNull(skill, '/tmp/workspace', 'both')).toBeNull();
  });
});
