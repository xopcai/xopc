import { describe, it, expect } from 'vitest';
import { isValidSkillId, MAX_SKILL_ZIP_BYTES, isIgnorableZipEntry } from '../managed-store.js';

describe('managed-store', () => {
  it('validates skill ids', () => {
    expect(isValidSkillId('a')).toBe(true);
    expect(isValidSkillId('my-skill_1')).toBe(true);
    expect(isValidSkillId('')).toBe(false);
    expect(isValidSkillId('-bad')).toBe(false);
    expect(isValidSkillId('a'.repeat(63))).toBe(true);
    expect(isValidSkillId('a'.repeat(64))).toBe(false);
  });

  it('exports zip size limit', () => {
    expect(MAX_SKILL_ZIP_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it('ignores macOS / junk zip paths', () => {
    expect(isIgnorableZipEntry('__MACOSX/pdf/SKILL.md')).toBe(true);
    expect(isIgnorableZipEntry('pdf/.DS_Store')).toBe(true);
    expect(isIgnorableZipEntry('pdf/._SKILL.md')).toBe(true);
    expect(isIgnorableZipEntry('pdf/SKILL.md')).toBe(false);
  });
});
