import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../utils/logger.js';
import { getGlobalPluginsDir } from '../config/paths.js';

const log = createLogger('SkillsLoader');

interface SkillManifest {
  name: string;
  description: string;
  metadata?: Record<string, unknown>;
}

interface SkillDefinition extends SkillManifest {
  content: string;
  path: string;
  origin: 'builtin' | 'workspace' | 'global';
}

interface SkillLoaderOptions {
  workspaceDir?: string;
  builtinDir?: string;
}

/**
 * Parse SKILL.md frontmatter
 */
function parseSkillMarkdown(content: string, filepath: string, origin: SkillDefinition['origin']): SkillDefinition | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    log.warn({ filepath }, 'Invalid SKILL.md format: missing frontmatter');
    return null;
  }

  const [, frontmatter, skillContent] = frontmatterMatch;
  
  const manifest: Partial<SkillManifest> = {};
  for (const line of frontmatter.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      if (key === 'metadata' && value) {
        try {
          (manifest as any)[key] = JSON.parse(value);
        } catch {
          // Ignore invalid JSON
        }
      } else {
        (manifest as any)[key] = value;
      }
    }
  }

  if (!manifest.name || !manifest.description) {
    log.warn({ filepath }, 'Invalid SKILL.md: missing name or description');
    return null;
  }

  return {
    name: manifest.name,
    description: manifest.description,
    metadata: manifest.metadata,
    content: skillContent.trim(),
    path: filepath,
    origin,
  };
}

/**
 * Convert skill definition to AgentTool
 */
function createSkillTool(skill: SkillDefinition): AgentTool<any, any> {
  const commandMatches = skill.content.match(/```bash\n([\s\S]*?)\n```/g) || [];
  const examples = commandMatches
    .map(m => m.replace(/```bash\n/, '').replace(/\n```$/, ''))
    .slice(0, 3);

  return {
    name: `skill_${skill.name}`,
    description: `${skill.description} [${skill.origin}]\n\nUsage examples:\n${examples.map(e => `$ ${e.split('\n')[0]}`).join('\n')}`,
    parameters: Type.Object({
      query: Type.String({ description: 'The query or location for the skill' }),
    }),
    label: `🎯 ${skill.name}`,

    async execute(_toolCallId: string, params: { query: string }) {
      try {
        let command = examples[0] || '';
        
        const placeholderMatch = command.match(/(?:curl[^"']*["'])([^"']+)(?:["'])/);
        if (placeholderMatch) {
          const url = placeholderMatch[1];
          const newUrl = url.replace(/\b(London|New\+York|Berlin|Paris|Tokyo)\b/i, encodeURIComponent(params.query));
          command = command.replace(url, newUrl);
        }

        log.debug({ command, skill: skill.name }, 'Executing skill');

        return {
          content: [{ 
            type: 'text', 
            text: `To ${skill.description.toLowerCase()}, run:\n\`\`\`bash\n${command}\n\`\`\`\n\nReplace the location/query with "${params.query}" as needed.` 
          }],
          details: { command, skill: skill.name },
        };
      } catch (error) {
        return {
          content: [{ 
            type: 'text', 
            text: `Error executing skill ${skill.name}: ${error instanceof Error ? error.message : String(error)}` 
          }],
          details: { error },
        };
      }
    },
  };
}

/**
 * Load skills from a single directory
 */
function loadSkillsFromDir(skillsDir: string, origin: SkillDefinition['origin']): SkillDefinition[] {
  const skills: SkillDefinition[] = [];

  if (!existsSync(skillsDir)) {
    log.debug({ skillsDir, origin }, 'Skills directory does not exist');
    return skills;
  }

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) {
        continue;
      }

      try {
        const content = readFileSync(skillPath, 'utf-8');
        const skill = parseSkillMarkdown(content, skillPath, origin);
        
        if (skill) {
          skills.push(skill);
          log.info({ skill: skill.name, origin }, 'Loaded skill');
        }
      } catch (error) {
        log.error({ err: error, skill: entry.name, origin }, 'Failed to load skill');
      }
    }
  } catch (error) {
    log.error({ err: error, skillsDir, origin }, 'Failed to read skills directory');
  }

  return skills;
}

/**
 * Load all skills from multiple sources with priority:
 * 1. Global (~/.xopcbot/skills/)
 * 2. Workspace (workspace/.skills/)
 * 3. Built-in (src/skills/) - lowest priority, can be overridden
 */
export function loadSkills(options: SkillLoaderOptions = {}): AgentTool<any, any>[] {
  const discovered = new Map<string, SkillDefinition>();
  
  const builtinDir = options.builtinDir || join(import.meta.dirname || '', '../skills');
  const workspaceDir = options.workspaceDir;

  // Priority 1: Global skills
  const globalDir = join(getGlobalPluginsDir(), '..', 'skills');
  const globalSkills = loadSkillsFromDir(globalDir, 'global');
  for (const skill of globalSkills) {
    discovered.set(skill.name, skill);
  }

  // Priority 2: Workspace skills (can override global)
  if (workspaceDir) {
    const workspaceSkillsDir = join(workspaceDir, '.skills');
    const workspaceSkills = loadSkillsFromDir(workspaceSkillsDir, 'workspace');
    for (const skill of workspaceSkills) {
      const existing = discovered.get(skill.name);
      if (existing) {
        log.info({ skill: skill.name, from: 'workspace', overriding: existing.origin }, 'Skill override');
      }
      discovered.set(skill.name, skill);
    }
  }

  // Priority 3: Built-in skills (lowest, can be overridden)
  const builtinSkills = loadSkillsFromDir(builtinDir, 'builtin');
  for (const skill of builtinSkills) {
    if (!discovered.has(skill.name)) {
      discovered.set(skill.name, skill);
    } else {
      log.debug({ skill: skill.name }, 'Skipping built-in skill (overridden)');
    }
  }

  const skills = Array.from(discovered.values());
  const tools = skills.map(createSkillTool);
  
  log.info({ count: tools.length, builtin: builtinSkills.length, workspace: workspaceDir ? 'yes' : 'no' }, 'Skills loaded');
  return tools;
}

/**
 * Get skill metadata for display
 */
export function listSkills(options: SkillLoaderOptions = {}): Array<{ name: string; description: string; origin: string }> {
  const builtinDir = options.builtinDir || join(import.meta.dirname || '', '../skills');
  const workspaceDir = options.workspaceDir;

  // Collect from all sources
  const allSkills = new Map<string, { name: string; description: string; origin: string }>();

  // Built-in
  const builtinSkills = loadSkillsFromDir(builtinDir, 'builtin');
  for (const skill of builtinSkills) {
    allSkills.set(skill.name, { name: skill.name, description: skill.description, origin: 'builtin' });
  }

  // Global
  const globalDir = join(getGlobalPluginsDir(), '..', 'skills');
  const globalSkills = loadSkillsFromDir(globalDir, 'global');
  for (const skill of globalSkills) {
    allSkills.set(skill.name, { name: skill.name, description: skill.description, origin: 'global' });
  }

  // Workspace
  if (workspaceDir) {
    const workspaceSkillsDir = join(workspaceDir, '.skills');
    const workspaceSkills = loadSkillsFromDir(workspaceSkillsDir, 'workspace');
    for (const skill of workspaceSkills) {
      allSkills.set(skill.name, { name: skill.name, description: skill.description, origin: 'workspace' });
    }
  }

  return Array.from(allSkills.values());
}
