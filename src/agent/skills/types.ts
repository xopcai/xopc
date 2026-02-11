/**
 * Skill system types for xopcbot
 * Based on Agent Skills specification (https://agentskills.io/specification)
 * 
 * Key principles:
 * - SKILL.md = pure documentation (platform-agnostic)
 * - Frontmatter follows Agent Skills spec
 * - Tool implementation is separate from skill definition
 */

/** Max name length per Agent Skills spec */
export const MAX_SKILL_NAME_LENGTH = 64;

/** Max description length per Agent Skills spec */
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

/** Skill source type */
export type SkillSource = 'builtin' | 'workspace' | 'global';

/**
 * Agent Skills spec frontmatter
 * See: https://agentskills.io/specification
 */
export interface SkillFrontmatter {
  /** Skill name in kebab-case (required, must match directory name) */
  name: string;
  /** What the skill does and when to use it (required) */
  description: string;
  /** License for the skill (optional) */
  license?: string;
  /** Compatibility info (optional) */
  compatibility?: string;
  /** Tool patterns the skill requires (optional, experimental) */
  'allowed-tools'?: string;
  /** Key-value pairs for client-specific properties (optional) */
  metadata?: Record<string, string>;
  /** @deprecated Use top-level fields instead. Was: xopcbot-specific config */
  'xopcbot-metadata'?: DeprecatedXopcbotMetadata;
  /** @deprecated Use top-level fields instead. Was: Disable automatic model invocation */
  'disable-model-invocation'?: boolean;
  /** Allow other fields for extensibility */
  [key: string]: unknown;
}

/**
 * @deprecated
 * Old xopcbot-specific metadata structure
 * Now preserved only for backward compatibility
 */
export interface DeprecatedXopcbotMetadata {
  /** Display emoji */
  emoji?: string;
  /** Skill category */
  category?: string;
  /** Required binaries */
  requires?: {
    bins?: string[];
    env?: string[];
  };
  /** @deprecated Tool invocation is agent's decision, not skill's */
  invoke_as?: 'tool' | 'command' | 'both';
  /** @deprecated Loading priority is determined by source priority */
  priority?: number;
}

/** Core skill interface */
export interface Skill {
  /** Skill name (normalized) */
  name: string;
  /** Skill description */
  description: string;
  /** Path to SKILL.md file */
  filePath: string;
  /** Base directory of the skill */
  baseDir: string;
  /** Source of the skill */
  source: SkillSource;
  /** Raw content (without frontmatter) */
  content: string;
  /** Raw frontmatter data */
  frontmatter: SkillFrontmatter;
  /** @deprecated Metadata is now platform-agnostic */
  metadata?: Record<string, string>;
  /** Disable automatic model invocation (top-level override) */
  disableModelInvocation?: boolean;
}

/** Validation error/warning */
export interface ValidationDiagnostic {
  type: 'error' | 'warning';
  message: string;
  path: string;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationDiagnostic[];
  warnings: ValidationDiagnostic[];
}

/** Eligibility check context */
export interface EligibilityContext {
  /** Check if binary exists */
  hasBinary: (bin: string) => boolean;
  /** Check if env var exists */
  hasEnv: (env: string) => boolean;
}

/** Eligibility result */
export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/** Discovery options */
export interface DiscoveryOptions {
  /** Directory to scan */
  dir: string;
  /** Source identifier */
  source: SkillSource;
  /** Respect ignore files (.gitignore, .ignore) */
  respectIgnoreFiles?: boolean;
}

/** Discovery result */
export interface DiscoveryResult {
  skills: Skill[];
  diagnostics: ValidationDiagnostic[];
}

/** Skill loader options */
export interface SkillLoaderOptions {
  /** Workspace directory for workspace skills */
  workspaceDir?: string;
  /** Override builtin directory */
  builtinDir?: string;
}

/** Skill with validation info */
export interface ValidatedSkill extends Skill {
  validation: ValidationResult;
}
