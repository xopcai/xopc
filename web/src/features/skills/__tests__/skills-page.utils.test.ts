import { describe, expect, it } from 'vitest';

import type { SkillDiagnostic } from '../skill.types';
import { displayableSkillDiagnostics } from '../skills-page.utils';

describe('displayableSkillDiagnostics', () => {
  it('hides source precedence collisions from the skills page', () => {
    const diagnostics: SkillDiagnostic[] = [
      {
        type: 'collision',
        skillName: 'find-skills',
        message: 'An agents-global skill shadows the bundled skill.',
      },
    ];

    expect(displayableSkillDiagnostics(diagnostics)).toEqual([]);
  });

  it('keeps diagnostics that may require user action', () => {
    const diagnostics: SkillDiagnostic[] = [
      { type: 'warning', message: 'Missing optional dependency.' },
      { type: 'error', message: 'SKILL.md could not be parsed.' },
      { type: 'skipped', message: 'Skill requirements are unmet.' },
    ];

    expect(displayableSkillDiagnostics(diagnostics)).toEqual(diagnostics);
  });
});
