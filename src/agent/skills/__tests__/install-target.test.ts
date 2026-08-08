import { describe, expect, it } from 'vitest';

import { normalizeSkillInstallTarget } from '../install-target.js';

describe('normalizeSkillInstallTarget', () => {
  it('defaults missing or invalid targets to global', () => {
    expect(normalizeSkillInstallTarget(undefined)).toBe('global');
    expect(normalizeSkillInstallTarget(null)).toBe('global');
    expect(normalizeSkillInstallTarget('invalid')).toBe('global');
  });

  it('preserves explicit workspace and global targets', () => {
    expect(normalizeSkillInstallTarget('workspace')).toBe('workspace');
    expect(normalizeSkillInstallTarget('global')).toBe('global');
  });
});
