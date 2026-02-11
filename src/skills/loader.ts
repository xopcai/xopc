import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SkillsLoader');

interface SkillManifest {
  name: string;
  description: string;
  metadata?: Record<string, unknown>;
}

interface SkillDefinition extends SkillManifest {
  content: string;
  path: string;
}

/**
 * Parse SKILL.md frontmatter
 * Format:
 * ---
 * name: skill-name
 * description: Skill description
 * metadata: {...}
 * ---
 */
function parseSkillMarkdown(content: string, filepath: string): SkillDefinition | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    log.warn({ filepath }, 'Invalid SKILL.md format: missing frontmatter');
    return null;
  }

  const [, frontmatter, skillContent] = frontmatterMatch;
  
  // Parse simple YAML-like frontmatter
  const manifest: Partial<SkillManifest> = {};
  for (const line of frontmatter.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      
      // Handle quoted strings
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      // Parse metadata JSON if present
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
  };
}

/**
 * Convert skill definition to AgentTool
 */
function createSkillTool(skill: SkillDefinition): AgentTool<any, any> {
  // Extract example commands from skill content
  const commandMatches = skill.content.match(/```bash\n([\s\S]*?)\n```/g) || [];
  const examples = commandMatches
    .map(m => m.replace(/```bash\n/, '').replace(/\n```$/, ''))
    .slice(0, 3); // Take first 3 examples

  return {
    name: `skill_${skill.name}`,
    description: `${skill.description}\n\nUsage examples:\n${examples.map(e => `$ ${e.split('\n')[0]}`).join('\n')}`,
    parameters: Type.Object({
      query: Type.String({ description: 'The query or location for the skill' }),
    }),
    label: `🎯 ${skill.name}`,

    async execute(_toolCallId: string, params: { query: string }) {
      try {
        // Replace placeholder in examples with actual query
        let command = examples[0] || '';
        
        // Simple placeholder replacement
        // Replace common patterns like "London", "New York" in the example with the query
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
 * Load all skills from the skills directory
 */
export function loadSkills(skillsDir: string = join(import.meta.dirname || '', '../skills')): AgentTool<any, any>[] {
  const tools: AgentTool<any, any>[] = [];

  if (!existsSync(skillsDir)) {
    log.debug({ skillsDir }, 'Skills directory does not exist');
    return tools;
  }

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) {
        log.debug({ skill: entry.name }, 'No SKILL.md found');
        continue;
      }

      try {
        const content = readFileSync(skillPath, 'utf-8');
        const skill = parseSkillMarkdown(content, skillPath);
        
        if (skill) {
          const tool = createSkillTool(skill);
          tools.push(tool);
          log.info({ skill: skill.name }, 'Loaded skill');
        }
      } catch (error) {
        log.error({ err: error, skill: entry.name }, 'Failed to load skill');
      }
    }
  } catch (error) {
    log.error({ err: error, skillsDir }, 'Failed to read skills directory');
  }

  log.info({ count: tools.length }, 'Skills loaded');
  return tools;
}

/**
 * Get skill metadata for display
 */
export function listSkills(skillsDir: string = join(import.meta.dirname || '', '../skills')): Array<{ name: string; description: string }> {
  const skills: Array<{ name: string; description: string }> = [];

  if (!existsSync(skillsDir)) return skills;

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;

      try {
        const content = readFileSync(skillPath, 'utf-8');
        const skill = parseSkillMarkdown(content, skillPath);
        if (skill) {
          skills.push({ name: skill.name, description: skill.description });
        }
      } catch {
        // Ignore
      }
    }
  } catch {
    // Ignore
  }

  return skills;
}
