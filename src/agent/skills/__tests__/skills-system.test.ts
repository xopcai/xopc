/**
 * Unit tests for new skill system modules
 */

import { describe, it, expect } from 'vitest';
import { 
  validateName, 
  validateDescription, 
  validateSkill 
} from '../validation.js';
import { 
  formatSkillsForPrompt, 
  formatSkillsList,
  formatSkillDetail 
} from '../prompt.js';
import { 
  hasBinary, 
  hasEnv, 
  checkEligibility 
} from '../eligibility.js';
import type { Skill, XopcbotMetadata } from '../types.js';

// Helper to create test skills
function createTestSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'test-skill',
    description: 'A test skill',
    filePath: '/test/skills/test-skill/SKILL.md',
    baseDir: '/test/skills/test-skill',
    source: 'builtin',
    disableModelInvocation: false,
    content: '# Test Skill\n\nContent',
    frontmatter: {},
    ...overrides
  };
}

describe('Skill Validation', () => {
  describe('validateName', () => {
    it('should accept valid names', () => {
      const errors = validateName('valid-skill', 'valid-skill');
      expect(errors.filter(e => e.type === 'error')).toHaveLength(0);
    });

    it('should reject names with uppercase', () => {
      const errors = validateName('InvalidSkill', 'InvalidSkill');
      expect(errors.some(e => e.message.includes('invalid characters'))).toBe(true);
    });

    it('should reject names starting with hyphen', () => {
      const errors = validateName('-invalid', '-invalid');
      expect(errors.some(e => e.message.includes('start or end with a hyphen'))).toBe(true);
    });

    it('should reject names with consecutive hyphens', () => {
      const errors = validateName('invalid--name', 'invalid--name');
      expect(errors.some(e => e.message.includes('consecutive hyphens'))).toBe(true);
    });

    it('should reject names exceeding 64 characters', () => {
      const longName = 'a'.repeat(65);
      const errors = validateName(longName, longName);
      expect(errors.some(e => e.message.includes('64 characters'))).toBe(true);
    });

    it('should warn when name does not match directory', () => {
      const errors = validateName('skill-name', 'directory-name');
      expect(errors.some(e => e.type === 'warning' && e.message.includes('does not match'))).toBe(true);
    });
  });

  describe('validateDescription', () => {
    it('should accept valid descriptions', () => {
      const errors = validateDescription('A valid description');
      expect(errors).toHaveLength(0);
    });

    it('should reject empty descriptions', () => {
      const errors = validateDescription('');
      expect(errors.some(e => e.message.includes('required'))).toBe(true);
    });

    it('should reject undefined descriptions', () => {
      const errors = validateDescription(undefined);
      expect(errors.some(e => e.message.includes('required'))).toBe(true);
    });

    it('should warn on descriptions exceeding 1024 characters', () => {
      const longDesc = 'a'.repeat(1025);
      const errors = validateDescription(longDesc);
      expect(errors.some(e => e.message.includes('1024'))).toBe(true);
    });
  });

  describe('validateSkill', () => {
    it('should validate a complete skill', () => {
      const skill = createTestSkill({ name: 'my-skill' });
      const result = validateSkill(skill);
      expect(result.valid).toBe(true);
    });

    it('should reject skill with invalid name', () => {
      const skill = createTestSkill({ name: 'InvalidName' });
      const result = validateSkill(skill);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

describe('Skill Prompt Formatting', () => {
  describe('formatSkillsForPrompt', () => {
    it('should return empty string for no skills', () => {
      const prompt = formatSkillsForPrompt([]);
      expect(prompt).toBe('');
    });

    it('should format skills in XML', () => {
      const skills = [
        createTestSkill({ name: 'weather', description: 'Get weather', metadata: { emoji: '🌤️', category: 'utilities' } }),
        createTestSkill({ name: 'github', description: 'GitHub CLI', metadata: { emoji: '🐙', category: 'devops' } }),
      ];
      const prompt = formatSkillsForPrompt(skills);
      expect(prompt).toContain('<available_skills>');
      expect(prompt).toContain('</skill>');
      expect(prompt).toContain('weather');
      expect(prompt).toContain('github');
    });

    it('should exclude skills with disableModelInvocation', () => {
      const skills = [
        createTestSkill({ name: 'visible', description: 'Visible skill' }),
        createTestSkill({ name: 'hidden', description: 'Hidden skill', disableModelInvocation: true }),
      ];
      const prompt = formatSkillsForPrompt(skills);
      expect(prompt).toContain('visible');
      expect(prompt).not.toContain('hidden');
    });

    it('should escape XML special characters', () => {
      const skills = [
        createTestSkill({ name: 'test', description: 'Use <script> tag & "quotes"' }),
      ];
      const prompt = formatSkillsForPrompt(skills);
      expect(prompt).toContain('&lt;script&gt;');
      expect(prompt).toContain('&quot;');
      expect(prompt).toContain('&amp;');
    });
  });

  describe('formatSkillsList', () => {
    it('should format skills as list', () => {
      const skills = [
        createTestSkill({ name: 'weather', description: 'Get weather', metadata: { emoji: '🌤️' } }),
      ];
      const list = formatSkillsList(skills);
      expect(list).toContain('🌤️');
      expect(list).toContain('weather');
    });

    it('should indicate manual-only skills', () => {
      const skills = [
        createTestSkill({ name: 'manual', description: 'Manual skill', disableModelInvocation: true }),
      ];
      const list = formatSkillsList(skills);
      expect(list).toContain('(manual only)');
    });
  });
});

describe('Skill Eligibility', () => {
  describe('hasEnv', () => {
    it('should return true for existing env vars', () => {
      process.env.TEST_VAR = 'test';
      expect(hasEnv('TEST_VAR')).toBe(true);
      delete process.env.TEST_VAR;
    });

    it('should return false for non-existing env vars', () => {
      expect(hasEnv('NON_EXISTENT_VAR_XYZ')).toBe(false);
    });
  });

  describe('checkEligibility', () => {
    it('should pass skill with no requirements', () => {
      const skill = createTestSkill();
      const result = checkEligibility(skill);
      expect(result.eligible).toBe(true);
    });

    it('should reject skill with missing binary', () => {
      const skill = createTestSkill({
        metadata: { requires: { bins: ['non-existent-binary-xyz'] } }
      });
      const result = checkEligibility(skill);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Missing required binary');
    });

    it('should reject skill with missing env var', () => {
      const skill = createTestSkill({
        metadata: { requires: { env: ['NON_EXISTENT_VAR_XYZ'] } }
      });
      const result = checkEligibility(skill);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Missing required environment variable');
    });

    it('should pass skill with existing env var', () => {
      process.env.TEST_API_KEY = 'secret';
      const skill = createTestSkill({
        metadata: { requires: { env: ['TEST_API_KEY'] } }
      });
      const result = checkEligibility(skill);
      expect(result.eligible).toBe(true);
      delete process.env.TEST_API_KEY;
    });
  });
});
