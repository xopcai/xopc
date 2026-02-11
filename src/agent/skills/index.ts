/**
 * Skill system for xopcbot
 * Unified exports for skill management
 */

// Types
export type {
  Skill,
  SkillFrontmatter,
  DeprecatedXopcbotMetadata,
  SkillSource,
  SkillCategory,
  ValidationDiagnostic,
  ValidationResult,
  EligibilityContext,
  EligibilityResult,
  DiscoveryOptions,
  DiscoveryResult,
  ToolGenerationOptions,
  SkillLoaderOptions,
} from './types.js';

export {
  MAX_SKILL_NAME_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
} from './types.js';

// Discovery
export { 
  discoverSkills,
  discoverSkillsFromMultiple 
} from './discovery.js';

// Validation
export {
  validateName,
  validateDescription,
  validateMetadata,
  validateSkill,
  validateAllSkills,
} from './validation.js';

// Eligibility
export {
  hasBinary,
  hasEnv,
  createDefaultEligibilityContext,
  checkEligibility,
  filterEligibleSkills,
  getEligibilityDiagnostics,
} from './eligibility.js';

// Prompt formatting
export {
  formatSkillsForPrompt,
  formatSkillsList,
  formatSkillDetail,
  formatSkillsSummary,
} from './prompt.js';

// Tools
export {
  createSkillTool,
  createToolsFromSkills,
  getCommandSkills,
  createSkillCommand,
} from './tools.js';

// High-level API
import { discoverSkillsFromMultiple } from './discovery.js';
import { validateAllSkills } from './validation.js';
import { filterEligibleSkills, createDefaultEligibilityContext } from './eligibility.js';
import { formatSkillsForPrompt } from './prompt.js';
import { createToolsFromSkills } from './tools.js';
import type { Skill, SkillSource, SkillLoaderOptions } from './types.js';
import { join } from 'path';
import { getGlobalPluginsDir } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Skills');

/**
 * Load skills from all sources with priority:
 * 1. Built-in (./skills/) - lowest priority
 * 2. Global (~/.xopcbot/skills/)
 * 3. Workspace (workspace/skills/) - highest priority
 * 
 * Backward compatible with existing loadSkills() API
 */
export function loadSkills(options: SkillLoaderOptions = {}): {
  skills: Skill[];
  prompt: string;
  tools: import('@mariozechner/pi-agent-core').AgentTool<any, any>[];
  diagnostics: import('./types.js').ValidationDiagnostic[];
} {
  const configs: Array<{ dir: string; source: SkillSource }> = [];

  // Priority 1: Built-in skills (lowest)
  const builtinDir = options.builtinDir || join(import.meta.dirname || '', '../../../skills');
  configs.push({ dir: builtinDir, source: 'builtin' });

  // Priority 2: Global skills
  try {
    const globalDir = join(getGlobalPluginsDir(), '..', 'skills');
    configs.push({ dir: globalDir, source: 'global' });
  } catch {
    // Global dir may not exist
  }

  // Priority 3: Workspace skills (highest)
  if (options.workspaceDir) {
    // Support both 'skills' and '.skills' directories for compatibility
    const workspaceDir1 = join(options.workspaceDir, 'skills');
    const workspaceDir2 = join(options.workspaceDir, '.skills');
    configs.push({ dir: workspaceDir1, source: 'workspace' });
    configs.push({ dir: workspaceDir2, source: 'workspace' });
  }

  // Discover all skills
  const { skills, diagnostics: discoveryDiagnostics } = discoverSkillsFromMultiple(configs);

  // Validate
  const { valid, invalid, allDiagnostics: validationDiagnostics } = validateAllSkills(skills);
  
  // Log invalid skills
  for (const { skill, result } of invalid) {
    for (const error of result.errors) {
      log.warn({ skill: skill.name, error: error.message }, 'Invalid skill');
    }
  }

  // Filter to eligible skills
  const context = createDefaultEligibilityContext();
  const { eligible, ineligible } = filterEligibleSkills(valid, context);

  // Log ineligible skills
  for (const { skill, reason } of ineligible) {
    log.debug({ skill: skill.name, reason }, 'Skill not eligible');
  }

  // Generate prompt
  const prompt = formatSkillsForPrompt(eligible);

  // Generate tools
  const tools = createToolsFromSkills(eligible);

  // Combine diagnostics
  const allDiagnostics = [...discoveryDiagnostics, ...validationDiagnostics];

  log.info({ 
    total: skills.length, 
    valid: valid.length, 
    eligible: eligible.length, 
    tools: tools.length 
  }, 'Skills loaded');

  return {
    skills: eligible,
    prompt,
    tools,
    diagnostics: allDiagnostics,
  };
}

/**
 * Simple skill list (for CLI/commands)
 */
export function listSkills(options: SkillLoaderOptions = {}): Skill[] {
  const { skills } = loadSkills(options);
  return skills;
}
