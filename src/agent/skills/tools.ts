/**
 * Skill to Tool conversion - generate AgentTools from skills
 * Preserves xopcbot's existing tool generation capabilities
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Skill, ToolGenerationOptions } from './types.js';
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
 * Looks for patterns like $VAR, ${VAR}, <var>, etc.
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

  // Replace $VAR and ${VAR}
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\$\\{?${key}\\}?`, 'g'), value);
    result = result.replace(new RegExp(`<${key}>`, 'g'), value);
  }

  // Replace common location/city patterns (London, New+York, etc.)
  const cityPattern = /\b(London|New\+York|Berlin|Paris|Tokyo|Beijing|Shanghai|New York)\b/gi;
  if (params.query && cityPattern.test(result)) {
    result = result.replace(cityPattern, encodeURIComponent(params.query));
  }

  return result;
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
  const emoji = skill.metadata?.emoji || '🎯';
  let description = `${skill.description} [${skill.source}]`;
  
  if (examples.length > 0) {
    description += '\n\nUsage examples:\n' + 
      examples.map(e => `$ ${e.split('\n')[0]}`).join('\n');
  }

  return {
    name: `skill_${skill.name}`,
    description,
    parameters,
    label: `${emoji} ${skill.name}`,

    async execute(toolCallId: string, params: Record<string, string>) {
      try {
        // Find the best example to use as template
        let template = examples[0] || '';
        
        // If no examples, create a generic response
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
 * Filters out skills that are disabled for model invocation
 */
export function createToolsFromSkills(
  skills: Skill[],
  options?: ToolGenerationOptions
): AgentTool<any, any>[] {
  const eligibleSkills = skills.filter(s => {
    const invokeAs = s.metadata?.invoke_as;
    // Skip if explicitly set to command_only
    if (invokeAs === 'command') return false;
    // Skip if model invocation is disabled
    if (s.disableModelInvocation) return false;
    return true;
  });

  log.info({ 
    total: skills.length, 
    toolsCreated: eligibleSkills.length 
  }, 'Creating tools from skills');

  return eligibleSkills.map(s => createSkillTool(s, options));
}

/**
 * Get skills that should be exposed as slash commands
 */
export function getCommandSkills(skills: Skill[]): Skill[] {
  return skills.filter(s => {
    const invokeAs = s.metadata?.invoke_as;
    return invokeAs === 'command' || invokeAs === 'both';
  });
}

/**
 * Create a skill invocation command
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
      // Simple implementation - could be enhanced
      return `Executing ${skill.name} with args: ${args}\n\nSee ${skill.filePath} for details.`;
    },
  };
}
