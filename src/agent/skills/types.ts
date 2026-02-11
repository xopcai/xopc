/**
 * Skill system types for xopcbot
 * Based on Claude Code + OpenClaw best practices
 */

/** Max name length per Agent Skills spec */
export const MAX_SKILL_NAME_LENGTH = 64;

/** Max description length per Agent Skills spec */
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

/** Skill categories */
export type SkillCategory = 
  | 'utilities' 
  | 'devops' 
  | 'ai' 
  | 'data' 
  | 'communication' 
  | 'media' 
  | 'system';

/** Xopcbot-specific metadata in skill frontmatter */
export interface XopcbotMetadata {
  /** Display emoji */
  emoji?: string;
  /** Skill category */
  category?: SkillCategory;
  /** Dependencies */
  requires?: {
    /** Required binaries */
    bins?: string[];
    /** Required environment variables */
    env?: string[];
  };
  /** How to invoke: tool=auto tool, command=slash command, both=both */
  invoke_as?: 'tool' | 'command' | 'both';
  /** Loading priority (higher = later override) */
  priority?: number;
}

/** Parsed skill frontmatter */
export interface SkillFrontmatter {
  /** Skill name (must match directory name) */
  name?: string;
  /** Skill description */
  description?: string;
  /** Disable automatic model invocation */
  'disable-model-invocation'?: boolean;
  /** Additional metadata */
  metadata?: {
    xopcbot?: XopcbotMetadata;
  };
  /** Allow other fields for extensibility */
  [key: string]: unknown;
}

/** Skill source type */
export type SkillSource = 'builtin' | 'workspace' | 'global';

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
  /** Whether model invocation is disabled */
  disableModelInvocation: boolean;
  /** Xopcbot metadata */
  metadata?: XopcbotMetadata;
  /** Raw content (without frontmatter) */
  content: string;
  /** Raw frontmatter data */
  frontmatter: SkillFrontmatter;
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

/** Tool generation options */
export interface ToolGenerationOptions {
  /** Infer parameters from bash examples */
  inferParameters?: boolean;
  /** Maximum examples to extract */
  maxExamples?: number;
}

/** Skill loader options (backward compatible) */
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

/** Skill collision info */
export interface SkillCollision {
  name: string;
  winnerPath: string;
  loserPath: string;
}
