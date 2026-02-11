import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSkills, listSkills } from '../skills/index.js';
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
    it('should return empty tools when skills directory does not exist', () => {
      const nonExistentDir = loadSkills({, 'non-existent');
      const result = join(testDir builtinDir: nonExistentDir });
      expect(result.tools).toHaveLength builtin directory', ()(0);
    });

    it(' => {
      constshould load skills from skillDir = join(testDir, 'weather');
      mkdirSync(skillDir, { recursive: true });
      
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: weather\ndescription: Get weather information\n---\n\n## Usage\n\`\`\`bash\ncurl -s "wttr.in/London"\n\`\`\``
      );

      const result = loadSkills({ builtinDir: testDir });
      
      expect(result.skills.some(s => s.name === 'weather')).toBe(true);
      expect(result.tools.some(t => t.name === 'skill_weather')).toBe(true);
    });

    it('should load skills from workspace directory', () => {
      const workspaceDir = join(testDir, 'workspace');
      const skillDir = join(workspaceDir, '.skills', 'custom-skill');
      mkdirSync(skillDir, { recursive: true });
      
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: custom-skill\ndescription: A custom workspace skill\n---\n\n## Usage\n\`\`\`bash\necho "hello"\n\`\`\``
      );

      const result = loadSkills({ workspaceDir });
      
      expect(result.skills.some(s => s.name === 'custom-skill')).toBe(true);
      expect(result.tools.some(t => t.name === 'skill_custom-skill')).toBe(true);
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

      const result = loadSkills({ 
        builtinDir: join(testDir, 'builtin'),
        workspaceDir 
      });
      
      // Should only have one weather skill (workspace overrides builtin)
      const weatherSkills = result.skills.filter(s => s.name === 'weather');
      expect(weatherSkills).toHaveLength(1);
      expect(weatherSkills[0].description).toContain('Custom weather skill');
    });

    it('should skip skills without SKILL.md', () => {
      const skillDir = join(testDir, 'incomplete');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'README.md'), 'No SKILL.md here');

      const result = loadSkills({ builtinDir: testDir });
      
      expect(result.skills).toHaveLength(0);
    });

    it('should skip invalid SKILL.md files', () => {
      const skillDir = join(testDir, 'invalid');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        'This is not a valid SKILL.md - no frontmatter'
      );

      const result = loadSkills({ builtinDir: testDir });
      
      expect(result.skills).toHaveLength(0);
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

      const result = loadSkills({ builtinDir: testDir });
      
      expect(result.tools.some(t => t.name === 'skill_test')).toBe(true);
      const tool = result.tools.find(t => t.name === 'skill_test')!;
      expect(tool.label).toBe('🎯 test');
      expect(tool.parameters).toBeDefined();
    });

    it('should execute skill tool and return command with query replaced', async () => {
      const skillDir = join(testDir, 'weather');
      mkdirSync(skillDir, { recursive: true });
      
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: weather\ndescription: Get weather\n---\n\n## Usage\n\`\`\`bash\ncurl -s "wttr.in/London?format=3"\n\`\`\``
      );

      const result = loadSkills({ builtinDir: testDir });
      const tool = result.tools.find(t => t.name === 'skill_weather')!;
      const executionResult = await tool.execute('test-id', { query: 'Beijing' });
      
      expect(executionResult.content[0].type).toBe('text');
      const textContent = executionResult.content[0] as { type: 'text'; text: string };
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
      
      expect(skills.some(s => s.name === 'skill1' && s.source === 'builtin')).toBe(true);
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
      
      expect(skills.some(s => s.name === 'workspace-skill' && s.source === 'workspace')).toBe(true);
    });

    it('should return empty array when no skills exist', () => {
      const skills = listSkills({ builtinDir: testDir });
      expect(skills).toHaveLength(0);
    });
  });
});
