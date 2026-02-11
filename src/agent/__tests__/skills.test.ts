import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSkills, listSkills } from '../skills.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Skills Loader', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `xopcbot-skills-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadSkills', () => {
    it('should return empty array when skills directory does not exist', () => {
      const nonExistentDir = join(testDir, 'non-existent');
      const skills = loadSkills({ builtinDir: nonExistentDir });
      expect(skills).toHaveLength(0);
    });

    it('should load skills from builtin directory', () => {
      const skillDir = join(testDir, 'weather');
      mkdirSync(skillDir, { recursive: true });
      
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: weather\ndescription: Get weather information\n---\n\n## Usage\n\`\`\`bash\ncurl -s "wttr.in/London"\n\`\`\``
      );

      const skills = loadSkills({ builtinDir: testDir });
      
      expect(skills.some(s => s.name === 'skill_weather')).toBe(true);
    });

    it('should load skills from workspace directory', () => {
      const workspaceDir = join(testDir, 'workspace');
      const skillDir = join(workspaceDir, '.skills', 'custom-skill');
      mkdirSync(skillDir, { recursive: true });
      
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: custom-skill\ndescription: A custom workspace skill\n---\n\n## Usage\n\`\`\`bash\necho "hello"\n\`\`\``
      );

      const skills = loadSkills({ workspaceDir });
      
      expect(skills.some(s => s.name === 'skill_custom-skill')).toBe(true);
    });

    it('should prioritize workspace skills over builtin skills', () => {
      // Create builtin skill
      const builtinSkillDir = join(testDir, 'builtin', 'weather');
      mkdirSync(builtinSkillDir, { recursive: true });
      writeFileSync(
        join(builtinSkillDir, 'SKILL.md'),
        `---\nname: weather\ndescription: Builtin weather skill\n---\n\n## Usage\n\`\`\`bash\ncurl wttr.in\n\`\`\``
      );

      // Create workspace skill with same name
      const workspaceDir = join(testDir, 'workspace');
      const workspaceSkillDir = join(workspaceDir, '.skills', 'weather');
      mkdirSync(workspaceSkillDir, { recursive: true });
      writeFileSync(
        join(workspaceSkillDir, 'SKILL.md'),
        `---\nname: weather\ndescription: Custom weather skill\n---\n\n## Usage\n\`\`\`bash\ncurl custom-weather.com\n\`\`\``
      );

      const skills = loadSkills({ 
        builtinDir: join(testDir, 'builtin'),
        workspaceDir 
      });
      
      // Should only have one weather skill (workspace overrides builtin)
      const weatherSkills = skills.filter(s => s.name === 'skill_weather');
      expect(weatherSkills).toHaveLength(1);
      expect(weatherSkills[0].description).toContain('Custom weather skill');
    });

    it('should skip skills without SKILL.md', () => {
      const skillDir = join(testDir, 'incomplete');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'README.md'), 'No SKILL.md here');

      const skills = loadSkills({ builtinDir: testDir });
      
      expect(skills).toHaveLength(0);
    });

    it('should skip invalid SKILL.md files', () => {
      const skillDir = join(testDir, 'invalid');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        'This is not a valid SKILL.md - no frontmatter'
      );

      const skills = loadSkills({ builtinDir: testDir });
      
      expect(skills).toHaveLength(0);
    });
  });

  describe('Skill tool execution', () => {
    it('should create skill tool with correct parameters schema', () => {
      const skillDir = join(testDir, 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: test\ndescription: A test skill\n---\n\n## Usage\n\`\`\`bash\ncurl "https://api.example.com?q=London"\n\`\`\``
      );

      const skills = loadSkills({ builtinDir: testDir });
      
      expect(skills.some(s => s.name === 'skill_test')).toBe(true);
      const skill = skills.find(s => s.name === 'skill_test')!;
      expect(skill.label).toBe('🎯 test');
      expect(skill.parameters).toBeDefined();
    });

    it('should execute skill tool and return command with query replaced', async () => {
      const skillDir = join(testDir, 'weather');
      mkdirSync(skillDir, { recursive: true });
      
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: weather\ndescription: Get weather\n---\n\n## Usage\n\`\`\`bash\ncurl -s "wttr.in/London?format=3"\n\`\`\``
      );

      const skills = loadSkills({ builtinDir: testDir });
      const skill = skills.find(s => s.name === 'skill_weather')!;
      const result = await skill.execute('test-id', { query: 'Beijing' });
      
      expect(result.content[0].type).toBe('text');
      const textContent = result.content[0] as { type: 'text'; text: string };
      expect(textContent.text).toContain('wttr.in/Beijing');
      expect(textContent.text).toContain('curl');
    });
  });

  describe('listSkills', () => {
    it('should include builtin skills', () => {
      const builtinDir = join(testDir, 'builtin', 'skill1');
      mkdirSync(builtinDir, { recursive: true });
      writeFileSync(
        join(builtinDir, 'SKILL.md'),
        `---\nname: skill1\ndescription: First skill\n---\n\nContent`
      );

      const skills = listSkills({ 
        builtinDir: join(testDir, 'builtin'),
      });
      
      expect(skills.some(s => s.name === 'skill1' && s.origin === 'builtin')).toBe(true);
    });

    it('should include workspace skills', () => {
      const workspaceDir = join(testDir, 'workspace');
      const skillDir = join(workspaceDir, '.skills', 'workspace-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: workspace-skill\ndescription: Workspace skill\n---\n\nContent`
      );

      const skills = listSkills({ workspaceDir });
      
      expect(skills.some(s => s.name === 'workspace-skill' && s.origin === 'workspace')).toBe(true);
    });

    it('should return empty array when no skills exist', () => {
      const skills = listSkills({ builtinDir: testDir });
      expect(skills).toHaveLength(0);
    });
  });
});
