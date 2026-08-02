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

  it('preserves multiline skill arguments used by local-app diagnostics', () => {
    const expanded = `## Skill: build-xopc-local-app

Build a local XOPC app.

**Arguments**: 请修复当前本地应用草稿的校验问题。

- Add a book: Visible text was not found
- Mark a book as read: Target was not found`;

    expect(collapseExpandedSkillBlockForDisplay(expanded)).toBe(
      `/skill:build-xopc-local-app 请修复当前本地应用草稿的校验问题。

- Add a book: Visible text was not found
- Mark a book as read: Target was not found`,
    );
  });
});
