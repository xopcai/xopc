// Skills System - Dynamic skill loading and management
import { readFileSync, existsSync, promises as fs } from 'fs';
import { join } from 'path';

// =============================================================================
// Types
// =============================================================================

export interface Skill {
  name: string;
  description: string;
  version: string;
  filePath: string;
  baseDir: string;
  prompt?: string;
  tools?: string[];
  dependencies?: string[];
  loadedAt: Date;
}

export interface SkillLoadResult {
  skills: Skill[];
  prompt: string;
  diagnostics: SkillDiagnostic[];
}

export interface SkillDiagnostic {
  type: 'info' | 'warning' | 'error' | 'collision';
  skillName: string;
  message: string;
}

export interface SkillLoadOptions {
  workspaceDir: string;
  globalDir?: string;
  builtinDir?: string;
}

// =============================================================================
// Skill Loader
// =============================================================================

export class SkillLoader {
  private loadedSkills: Map<string, Skill> = new Map();
  private skillCache: Map<string, SkillLoadResult> = new Map();

  /**
   * Load skills from configured directories
   */
  async load(options: SkillLoadOptions): Promise<SkillLoadResult> {
    const { workspaceDir, globalDir, builtinDir } = options;
    const skills: Skill[] = [];
    const diagnostics: SkillDiagnostic[] = [];

    // Skill directories in priority order
    const directories = [
      { dir: builtinDir, priority: 'low' },
      { dir: globalDir, priority: 'medium' },
      { dir: workspaceDir, priority: 'high' },
    ].filter(d => d.dir && existsSync(d.dir));

    // Collect all skills
    const skillMap = new Map<string, { skill: Skill; priority: string }>();

    for (const { dir, priority } of directories) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const skillPath = join(dir, entry.name);
            const skillFile = join(skillPath, 'SKILL.md');
            
            if (existsSync(skillFile)) {
              try {
                const skill = await this.parseSkillFile(skillFile, dir, entry.name);
                const existing = skillMap.get(skill.name);
                
                if (existing) {
                  // Higher priority wins
                  if (this.comparePriority(priority, existing.priority) > 0) {
                    diagnostics.push({
                      type: 'collision',
                      skillName: skill.name,
                      message: `Replaced ${existing.skill.filePath} with ${skill.filePath} (higher priority)`,
                    });
                    skillMap.set(skill.name, { skill, priority });
                  } else {
                    diagnostics.push({
                      type: 'collision',
                      skillName: skill.name,
                      message: `Ignored ${skill.filePath} (lower priority than ${existing.skill.filePath})`,
                    });
                  }
                } else {
                  skillMap.set(skill.name, { skill, priority });
                }
              } catch (error) {
                diagnostics.push({
                  type: 'error',
                  skillName: entry.name,
                  message: `Failed to parse: ${error instanceof Error ? error.message : String(error)}`,
                });
              }
            }
          }
        }
      } catch (error) {
        diagnostics.push({
          type: 'error',
          skillName: dir,
          message: `Failed to read directory: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    // Convert map to array
    for (const { skill } of skillMap.values()) {
      skills.push(skill);
      this.loadedSkills.set(skill.name, skill);
    }

    // Generate combined prompt
    const prompt = this.buildSkillsPrompt(skills);

    // Cache result
    const cacheKey = `${workspaceDir}:${globalDir || ''}:${builtinDir || ''}`;
    this.skillCache.set(cacheKey, { skills, prompt, diagnostics });

    return { skills, prompt, diagnostics };
  }

  /**
   * Reload skills (hot reload)
   */
  async reload(options: SkillLoadOptions): Promise<SkillLoadResult> {
    // Clear cache
    const cacheKey = `${options.workspaceDir}:${options.globalDir || ''}:${options.builtinDir || ''}`;
    this.skillCache.delete(cacheKey);
    
    // Clear loaded skills
    this.loadedSkills.clear();
    
    // Reload
    return this.load(options);
  }

  /**
   * Get a specific skill by name
   */
  get(name: string): Skill | undefined {
    return this.loadedSkills.get(name);
  }

  /**
   * List all loaded skills
   */
  list(): Skill[] {
    return Array.from(this.loadedSkills.values());
  }

  /**
   * Check if a skill is loaded
   */
  has(name: string): boolean {
    return this.loadedSkills.has(name);
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private async parseSkillFile(filePath: string, baseDir: string, name: string): Promise<Skill> {
    const content = readFileSync(filePath, 'utf-8');
    
    // Parse frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    
    let description = '';
    let version = '1.0.0';
    let prompt = '';
    let tools: string[] = [];
    let dependencies: string[] = [];

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      prompt = frontmatterMatch[2].trim();
      
      // Parse YAML frontmatter
      const descMatch = frontmatter.match(/description:\s*(.+)/);
      if (descMatch) {
        description = descMatch[1].trim();
      }
      
      const verMatch = frontmatter.match(/version:\s*(.+)/);
      if (verMatch) {
        version = verMatch[1].trim();
      }
    } else {
      // No frontmatter, use filename as description
      description = name;
      prompt = content;
    }

    return {
      name,
      description,
      version,
      filePath,
      baseDir,
      prompt,
      tools,
      dependencies,
      loadedAt: new Date(),
    };
  }

  private buildSkillsPrompt(skills: Skill[]): string {
    if (skills.length === 0) {
      return '';
    }

    const lines = [
      '',
      '## Loaded Skills',
      '',
    ];

    for (const skill of skills) {
      lines.push(`### ${skill.name} v${skill.version}`);
      if (skill.description) {
        lines.push(skill.description);
      }
      if (skill.prompt) {
        lines.push('', skill.prompt);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private comparePriority(a: string, b: string): number {
    const order = { high: 3, medium: 2, low: 1 };
    return (order[a as keyof typeof order] || 0) - (order[b as keyof typeof order] || 0);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const skillLoader = new SkillLoader();

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Load skills with default options
 */
export async function loadSkills(options: SkillLoadOptions): Promise<SkillLoadResult> {
  return skillLoader.load(options);
}

/**
 * Reload skills (hot reload)
 */
export async function reloadSkills(options: SkillLoadOptions): Promise<SkillLoadResult> {
  return skillLoader.reload(options);
}

/**
 * Get a skill by name
 */
export function getSkill(name: string): Skill | undefined {
  return skillLoader.get(name);
}

/**
 * List all skills
 */
export function listSkills(): Skill[] {
  return skillLoader.list();
}

/**
 * Format skill for display
 */
export function formatSkillForDisplay(skill: Skill): string {
  return [
    `Name: ${skill.name}`,
    `Version: ${skill.version}`,
    `Description: ${skill.description}`,
    `Path: ${skill.filePath}`,
    `Loaded: ${skill.loadedAt.toISOString()}`,
  ].join('\n');
}

/**
 * Find skills matching a query
 */
export function findSkills(query: string): Skill[] {
  const queryLower = query.toLowerCase();
  
  return listSkills().filter(skill => 
    skill.name.toLowerCase().includes(queryLower) ||
    skill.description.toLowerCase().includes(queryLower)
  );
}
