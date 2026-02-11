/**
 * Skills loader - backward compatible API
 * Uses the new modular skill system internally
 * @deprecated Use src/agent/skills/ module directly
 */

import { 
  loadSkills as loadSkillsNew, 
  listSkills as listSkillsNew,
  type SkillLoaderOptions 
} from './skills/index.js';
import type { AgentTool } from '@mariozechner/pi-agent-core';

/**
 * Backward compatible loadSkills - returns tools array
 * @deprecated Use loadSkills from ./skills/index.js instead (returns full result object)
 */
export function loadSkills(options: SkillLoaderOptions = {}): AgentTool<any, any>[] {
  const result = loadSkillsNew(options);
  return result.tools;
}

/**
 * Backward compatible listSkills - returns simplified skill info
 * @deprecated Use listSkills from ./skills/index.js instead (returns full Skill objects)
 */
export function listSkills(options: SkillLoaderOptions = {}): Array<{ 
  name: string; 
  description: string; 
  origin: string 
}> {
  const skills = listSkillsNew(options);
  return skills.map(s => ({
    name: s.name,
    description: s.description,
    origin: s.source,
  }));
}

// Re-export new types for compatibility
export type { SkillLoaderOptions } from './skills/index.js';
export type { Skill } from './skills/types.js';
