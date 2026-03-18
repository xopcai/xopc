/**
 * Skill Manager - Manages skills loading and expansion
 *
 * Handles skill initialization, reloading, and command expansion.
 */

import { createSkillLoader, type Skill } from './index.js';
import { getBundledSkillsDir } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SkillManager');

export interface SkillDiagnostic {
  type: 'collision' | 'warning' | 'error' | 'info';
  skillName: string;
  message: string;
}

export interface SkillLoadResult {
  skills: Skill[];
  prompt: string;
  diagnostics: SkillDiagnostic[];
}

export class SkillManager {
  private skillPrompt: string = '';
  private skills: Skill[] = [];
  private skillLoader = createSkillLoader();
  private workspace: string;
  private bundledSkillsDir: string;

  constructor(workspace: string, bundledSkillsDir?: string) {
    this.workspace = workspace;
    this.bundledSkillsDir = bundledSkillsDir || getBundledSkillsDir();
    this.initialize();
  }

  /**
   * Initialize skills from workspace and bundled directories
   */
  private initialize(): void {
    const result = this.skillLoader.init(this.workspace, this.bundledSkillsDir);
    this.skillPrompt = result.prompt;
    this.skills = result.skills;

    // Log diagnostics
    for (const diag of result.diagnostics) {
      if (diag.type === 'collision') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill collision');
      } else if (diag.type === 'warning') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill warning');
      } else if (diag.type === 'error') {
        log.error({ skill: diag.skillName, message: diag.message }, 'Skill error');
      } else {
        log.info({ skill: diag.skillName, message: diag.message }, 'Skill info');
      }
    }

    log.debug({ count: result.skills.length }, 'Skills loaded');
  }

  /**
   * Reload skills from disk
   */
  reload(): void {
    log.info('Reloading skills...');
    const result = this.skillLoader.reload();
    this.skillPrompt = result.prompt;
    this.skills = result.skills;

    for (const diag of result.diagnostics) {
      if (diag.type === 'collision') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill collision');
      } else if (diag.type === 'warning') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill warning');
      } else if (diag.type === 'error') {
        log.error({ skill: diag.skillName, message: diag.message }, 'Skill error');
      }
    }

    log.info({ count: result.skills.length }, 'Skills reloaded');
  }

  /**
   * Get the skill prompt to append to system prompt
   */
  getPrompt(): string {
    return this.skillPrompt;
  }

  /**
   * Get all loaded skills
   */
  getSkills(): Skill[] {
    return [...this.skills];
  }

  /**
   * Get skill names
   */
  getSkillNames(): string[] {
    return this.skills.map(s => s.name);
  }

  /**
   * Find a skill by name
   */
  findSkill(name: string): Skill | undefined {
    return this.skills.find(s => s.name === name);
  }

  /**
   * Check if a skill exists
   */
  hasSkill(name: string): boolean {
    return this.skills.some(s => s.name === name);
  }

  /**
   * Expand a skill command into a full skill block
   */
  expandCommand(text: string): string {
    if (!text.startsWith('/skill:')) {
      return text;
    }

    const { skillName, args } = this.parseSkillCommand(text);
    const skill = this.findSkill(skillName);

    if (!skill) {
      log.warn({ skillName }, 'Skill not found for expansion');
      return text;
    }

    return this.buildSkillBlock(skill, args);
  }

  /**
   * Parse a /skill: command
   */
  private parseSkillCommand(text: string): { skillName: string; args?: string } {
    // Format: /skill:name args...
    const withoutPrefix = text.slice(7); // Remove '/skill:'
    const spaceIndex = withoutPrefix.indexOf(' ');

    if (spaceIndex === -1) {
      return { skillName: withoutPrefix.trim() };
    }

    return {
      skillName: withoutPrefix.slice(0, spaceIndex).trim(),
      args: withoutPrefix.slice(spaceIndex + 1).trim(),
    };
  }

  /**
   * Build a skill block for inclusion in the prompt
   */
  private buildSkillBlock(skill: Skill, args?: string): string {
    let block = `\n\n## Skill: ${skill.name}\n\n`;
    
    if (skill.description) {
      block += `${skill.description}\n\n`;
    }

    // Include raw skill content (SKILL.md content)
    if (skill.content) {
      block += `${skill.content}\n\n`;
    }

    if (args) {
      block += `**Arguments**: ${args}\n\n`;
    }

    return block;
  }
}
