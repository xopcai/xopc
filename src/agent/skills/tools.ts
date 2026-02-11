/**
 * Skill to Tool conversion - generate AgentTools from skills
 * 
 * Key principles:
 * - Skill = pure documentation (what and when)
 * - Tool = code implementation (how)
 * - Agent decides when to use based on skill description
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Skill, ToolGenerationOptions, DeprecatedXopcbotMetadata } from './types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SkillTools');

/**
 * Extract bash examples from skill content
 */
function extractBashExamples(content: string, maxExamples: number = 3): string[] {
  const commandMatches = content.match(/```bash\n([\s\S]*?)\n```/g) || [];
  return commandMatches
    .map(m => m.replace(/```bash\n/, '').replace(/\n```$/, ''))
    .slice(0, maxExamples);
}

/**
 * Extract parameter placeholders from command
 */
function extractParameters(command: string): Array<{ name: string; type: string }> {
  const params: Array<{ name: string; type: string }> = [];
  const seen = new Set<string>();

  // Match $VAR or ${VAR}
  const envMatches = command.match(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g) || [];
  for (const match of envMatches) {
    const name = match.replace(/^\$\{?/, '').replace(/\}$/, '');
    if (!seen.has(name)) {
      seen.add(name);
      params.push({ name, type: 'string' });
    }
  }

  // Match <var> placeholders
  const angleMatches = command.match(/<([A-Za-z_][A-Za-z0-9_]*)\u003e/g) || [];
  for (const match of angleMatches) {
    const name = match.replace(/<|>/g, '');
    if (!seen.has(name)) {
      seen.add(name);
      params.push({ name, type: 'string' });
    }
  }

  return params;
}

/**
 * Infer tool parameters from skill content
 */
function inferParameters(skill: Skill): Record<string, any> {
  const examples = extractBashExamples(skill.content);
  const allParams: Array<{ name: string; type: string }> = [];
  const seen = new Set<string>();

  for (const example of examples) {
    const params = extractParameters(example);
    for (const param of params) {
      if (!seen.has(param.name)) {
        seen.add(param.name);
        allParams.push(param);
      }
    }
  }

  // Build TypeBox schema
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const param of allParams) {
    properties[param.name] = Type.String({ 
      description: `Parameter ${param.name}` 
    });
    required.push(param.name);
  }

  // If no params found, use a generic 'query' param
  if (allParams.length === 0) {
    properties.query = Type.String({ 
      description: 'The query or input for the skill' 
    });
    required.push('query');
  }

  return Type.Object(properties, { required });
}

/**
 * Replace placeholders in command with actual values
 */
function substituteParams(command: string, params: Record<string, string>): string {
  let result = command;

  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\$\\{?${key}\\}?`, 'g'), value);
    result = result.replace(new RegExp(`<${key}>`, 'g'), value);
  }

  // Replace common location/city patterns
  const cityPattern = /\b(London|New\+York|Berlin|Paris|Tokyo|Beijing|Shanghai|New York)\b/gi;
  if (params.query && cityPattern.test(result)) {
    result = result.replace(cityPattern, encodeURIComponent(params.query));
  }

  return result;
}

/**
 * Get emoji from deprecated xopcbot metadata or metadata
 */
function getEmoji(skill: Skill): string {
  const oldMeta = skill.frontmatter['xopcbot-metadata'];
  if (oldMeta?.emoji) return oldMeta.emoji;
  if (skill.metadata?.emoji) return skill.metadata.emoji;
  return '🎯';
}

/**
 * Should this skill generate a tool?
 * (Agent decides based on description, we just provide the tool)
 */
function shouldGenerateTool(skill: Skill): boolean {
  const oldMeta = skill.frontmatter['xopcbot-metadata'];
  const invokeAs = oldMeta?.invoke_as;
  
  // Skip if explicitly command-only
  if (invokeAs === 'command') return false;
  
  // Skip if model invocation is disabled
  if (skill.frontmatter['disable-model-invocation']) return false;
  
  return true;
}

/**
 * Create an AgentTool from a Skill
 */
export function createSkillTool(
  skill: Skill, 
  options: ToolGenerationOptions = {}
): AgentTool<any, any> {
  const { maxExamples = 3 } = options;
  const examples = extractBashExamples(skill.content, maxExamples);
  const parameters = inferParameters(skill);

  // Build description
  let description = `${skill.description} [${skill.source}]`;
  
  if (examples.length > 0) {
    description += '\n\nUsage examples:\n' + 
      examples.map(e => `$ ${e.split('\n')[0]}`).join('\n');
  }

  return {
    name: `skill_${skill.name}`,
    description,
    parameters,
    label: `${getEmoji(skill)} ${skill.name}`,

    async execute(toolCallId: string, params: Record<string, string>) {
      try {
        // Find the best example to use as template
        let template = examples[0] || '';
        
        if (!template) {
          return {
            content: [{ 
              type: 'text', 
              text: `Skill "${skill.name}" executed with params: ${JSON.stringify(params)}` 
            }],
            details: { skill: skill.name, params },
          };
        }

        // Substitute parameters
        const command = substituteParams(template, params);

        log.debug({ command, skill: skill.name, toolCallId }, 'Executing skill');

        return {
          content: [{ 
            type: 'text', 
            text: `To ${skill.description.toLowerCase()}, run:\n\`\`\`bash\n${command}\n\`\`\`\n\nParameters: ${JSON.stringify(params)}` 
          }],
          details: { command, skill: skill.name, params },
        };
      } catch (error) {
        log.error({ error, skill: skill.name }, 'Skill execution failed');
        return {
          content: [{ 
            type: 'text', 
            text: `Error executing skill ${skill.name}: ${error instanceof Error ? error.message : String(error)}` 
          }],
          details: { error, skill: skill.name },
        };
      }
    },
  };
}

/**
 * Create tools from multiple skills
 */
export function createToolsFromSkills(
  skills: Skill[],
  options?: ToolGenerationOptions
): AgentTool<any, any>[] {
  const eligibleSkills = skills.filter(shouldGenerateTool);

  log.info({ 
    total: skills.length, 
    toolsCreated: eligibleSkills.length 
  }, 'Creating tools from skills');

  return eligibleSkills.map(s => createSkillTool(s, options));
}

/**
 * Get skills that should be exposed as slash commands
 * @deprecated Tool vs command is agent's decision, not skill's
 */
export function getCommandSkills(skills: Skill[]): Skill[] {
  return skills.filter(s => {
    const oldMeta = s.frontmatter['xopcbot-metadata'];
    const invokeAs = oldMeta?.invoke_as;
    return invokeAs === 'command' || invokeAs === 'both';
  });
}

/**
 * Create a skill invocation command (for backward compatibility)
 * @deprecated Use skill documentation directly
 */
export function createSkillCommand(skill: Skill): {
  name: string;
  description: string;
  execute: (args: string) => Promise<string>;
} {
  return {
    name: skill.name,
    description: skill.description,
    async execute(args: string): Promise<string> {
      return `Executing ${skill.name} with args: ${args}\n\nSee ${skill.filePath} for details.`;
    },
  };
}
