import { describe, it, expect } from 'vitest';
import { collapseExpandedSkillBlockForDisplay } from '@/features/chat/messages/wire-text-scrub';

describe('collapseExpandedSkillBlockForDisplay', () => {
  it('returns wire text unchanged when not an expanded skill block', () => {
    expect(collapseExpandedSkillBlockForDisplay('/skill:foo hello')).toBe('/skill:foo hello');
    expect(collapseExpandedSkillBlockForDisplay('plain')).toBe('plain');
  });

  it('collapses SkillManager-style expansion to /skill:name', () => {
    const expanded = `

## Skill: babysit

Short description.

# SKILL.md body line

**Arguments**: user trailing text
`;
    expect(collapseExpandedSkillBlockForDisplay(expanded)).toBe('/skill:babysit user trailing text');
  });

  it('collapses without Arguments line to /skill:name only', () => {
    const expanded = `

## Skill: weather

Only description and body.
`;
    expect(collapseExpandedSkillBlockForDisplay(expanded)).toBe('/skill:weather');
  });
});
