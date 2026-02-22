/**
 * Skill Test Framework Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  SkillTestFramework,
  SkillTestRunner,
  formatTestResults,
  formatTestResultsJson,
  formatTestResultsTap,
} from '../test-framework.js';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';

describe('SkillTestFramework', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), 'test-skills-temp');
  });

  describe('testSkillMdFormat', () => {
    it('should pass for valid SKILL.md', () => {
      const framework = new SkillTestFramework();
      const validSkill = `---
name: test-skill
description: A test skill
emoji: 🧪
---

# Test Skill

This is a test skill.
`;

      const filePath = join(testDir, 'SKILL.md');
      mkdirSync(testDir, { recursive: true });
      writeFileSync(filePath, validSkill);

      const result = framework.testSkillMdFormat(filePath);
      
      expect(result.status).toBe('pass');
      expect(result.name).toBe('SKILL.md format');
      
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should fail for missing frontmatter', () => {
      const framework = new SkillTestFramework();
      const invalidSkill = `# Test Skill

No frontmatter here.
`;

      const filePath = join(testDir, 'SKILL.md');
      mkdirSync(testDir, { recursive: true });
      writeFileSync(filePath, invalidSkill);

      const result = framework.testSkillMdFormat(filePath);
      
      expect(result.status).toBe('fail');
      expect(result.message).toContain('frontmatter');
      
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should fail for missing required fields', () => {
      const framework = new SkillTestFramework();
      const invalidSkill = `---
emoji: 🧪
---

# Test Skill
`;

      const filePath = join(testDir, 'SKILL.md');
      mkdirSync(testDir, { recursive: true });
      writeFileSync(filePath, invalidSkill);

      const result = framework.testSkillMdFormat(filePath);
      
      expect(result.status).toBe('fail');
      expect(result.message).toContain('required');
      
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should warn for short content', () => {
      const framework = new SkillTestFramework();
      const shortSkill = `---
name: test
description: Test
---

Hi
`;

      const filePath = join(testDir, 'SKILL.md');
      mkdirSync(testDir, { recursive: true });
      writeFileSync(filePath, shortSkill);

      const result = framework.testSkillMdFormat(filePath);
      
      expect(result.status).toBe('warn');
      expect(result.message).toContain('short');
      
      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('testDependencies', () => {
    it('should skip when no dependencies declared', async () => {
      const framework = new SkillTestFramework();
      const metadata = {
        name: 'test',
        description: 'test',
      };

      const result = await framework.testDependencies(metadata);
      
      expect(result.status).toBe('skip');
      expect(result.message).toContain('No dependencies');
    });

    it('should pass when required binary exists', async () => {
      const framework = new SkillTestFramework();
      const metadata = {
        name: 'test',
        description: 'test',
        requires: {
          bins: ['node'], // node should exist
        },
      };

      const result = await framework.testDependencies(metadata);
      
      expect(result.status).toBe('pass');
    });

    it('should fail when required binary missing', async () => {
      const framework = new SkillTestFramework();
      const metadata = {
        name: 'test',
        description: 'test',
        requires: {
          bins: ['nonexistent-binary-xyz123'],
        },
      };

      const result = await framework.testDependencies(metadata);
      
      expect(result.status).toBe('fail');
      expect(result.message).toContain('Missing');
    });

    it('should pass anyBins when at least one exists', async () => {
      const framework = new SkillTestFramework();
      const metadata = {
        name: 'test',
        description: 'test',
        requires: {
          anyBins: ['nonexistent-abc', 'node'],
        },
      };

      const result = await framework.testDependencies(metadata);
      
      expect(result.status).toBe('pass');
    });
  });

  describe('testMetadata', () => {
    it('should pass for complete metadata', () => {
      const framework = new SkillTestFramework();
      const metadata = {
        name: 'test',
        description: 'test',
        emoji: '🧪',
        homepage: 'https://example.com',
      };

      const result = framework.testMetadata(metadata, '/test');
      
      expect(result.status).toBe('pass');
    });

    it('should warn for missing optional fields', () => {
      const framework = new SkillTestFramework();
      const metadata = {
        name: 'test',
        description: 'test',
      };

      const result = framework.testMetadata(metadata, '/test');
      
      expect(result.status).toBe('warn');
    });
  });

  describe('testExamples', () => {
    it('should warn when no examples found', async () => {
      const framework = new SkillTestFramework();
      const content = `---
name: test
description: test
---

# Test

No code examples here.
`;

      const result = await framework.testExamples(content, '/test');
      
      expect(result.status).toBe('warn');
      expect(result.message).toContain('No code examples');
    });

    it('should pass for valid shell examples', async () => {
      const framework = new SkillTestFramework();
      const content = `---
name: test
description: test
---

# Test

\`\`\`bash
echo "Hello"
ls -la
\`\`\`
`;

      const result = await framework.testExamples(content, '/test');
      
      expect(result.status).toBe('pass');
    });

    it('should fail for invalid shell syntax', async () => {
      const framework = new SkillTestFramework();
      const content = `---
name: test
description: test
---

# Test

\`\`\`bash
echo "unclosed quote
\`\`\`
`;

      const result = await framework.testExamples(content, '/test');
      
      expect(result.status).toBe('fail');
    });
  });

  describe('testSkill (integration)', () => {
    it('should test complete skill successfully', async () => {
      const framework = new SkillTestFramework({
        skipExamples: true, // Skip examples for faster tests
      });

      const skillDir = join(testDir, 'complete-skill');
      const skillContent = `---
name: complete-test
description: A complete test skill
emoji: ✅
homepage: https://example.com
requires:
  bins: [node]
---

# Complete Test Skill

This is a complete skill with all metadata.

## Usage

\`\`\`bash
node --version
\`\`\`
`;

      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), skillContent);

      const report = await framework.testSkill(skillDir);
      
      expect(report.skillName).toBe('complete-skill');
      expect(report.summary.total).toBeGreaterThan(0);
      
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should fail for invalid skill', async () => {
      const framework = new SkillTestFramework();

      const skillDir = join(testDir, 'invalid-skill');
      mkdirSync(skillDir, { recursive: true });
      // No SKILL.md file

      const report = await framework.testSkill(skillDir);
      
      expect(report.passed).toBe(false);
      expect(report.summary.failed).toBeGreaterThan(0);
      
      rmSync(testDir, { recursive: true, force: true });
    });
  });
});

describe('SkillTestRunner', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), 'test-skills-runner-temp');
  });

  it('should run tests for multiple skills', async () => {
    // Create test skills
    const skill1Dir = join(testDir, 'skill-1');
    const skill2Dir = join(testDir, 'skill-2');

    mkdirSync(skill1Dir, { recursive: true });
    mkdirSync(skill2Dir, { recursive: true });

    writeFileSync(join(skill1Dir, 'SKILL.md'), `---
name: skill-1
description: Test skill 1
---

# Skill 1
`);

    writeFileSync(join(skill2Dir, 'SKILL.md'), `---
name: skill-2
description: Test skill 2
---

# Skill 2
`);

    const runner = new SkillTestRunner({
      skillsDir: testDir,
      skipExamples: true,
      skipSecurity: true,
    });

    const { reports } = await runner.run();
    
    expect(reports.length).toBe(2);
    expect(reports.map(r => r.skillName)).toEqual(
      expect.arrayContaining(['skill-1', 'skill-2'])
    );
    
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe('Result Formatters', () => {
  const mockReport = {
    skillName: 'test-skill',
    skillPath: '/test',
    timestamp: Date.now(),
    results: [
      { name: 'Format', status: 'pass' as const, message: 'OK' },
      { name: 'Deps', status: 'pass' as const, message: 'OK' },
      { name: 'Security', status: 'warn' as const, message: 'Warning' },
    ],
    summary: {
      total: 3,
      passed: 2,
      failed: 0,
      warnings: 1,
      skipped: 0,
    },
    passed: true,
  };

  describe('formatTestResults', () => {
    it('should format as text', () => {
      const output = formatTestResults([mockReport]);
      
      expect(output).toContain('test-skill');
      expect(output).toContain('✅');
      expect(output).toContain('Summary:');
    });

    it('should show details in verbose mode', () => {
      const reportWithDetails = {
        ...mockReport,
        results: [
          { 
            name: 'Format', 
            status: 'pass' as const, 
            message: 'OK',
            details: ['Detail 1', 'Detail 2'],
          },
        ],
        summary: { ...mockReport.summary, total: 1, passed: 1 },
      };

      const output = formatTestResults([reportWithDetails], true);
      
      expect(output).toContain('Detail 1');
    });
  });

  describe('formatTestResultsJson', () => {
    it('should format as valid JSON', () => {
      const output = formatTestResultsJson([mockReport]);
      const parsed = JSON.parse(output);
      
      expect(parsed.totalSkills).toBe(1);
      expect(parsed.reports).toHaveLength(1);
    });
  });

  describe('formatTestResultsTap', () => {
    it('should format as TAP', () => {
      const output = formatTestResultsTap([mockReport]);
      
      expect(output).toContain('TAP version 13');
      expect(output).toMatch(/1\.\.\d+/);
      expect(output).toContain('ok');
    });
  });
});
