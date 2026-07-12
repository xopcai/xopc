/**
 * Skill System Types
 * 
 *
 */

// ============================================================================
// Skill Metadata
// ============================================================================

export type SkillInstallKind = 'pnpm' | 'npm' | 'yarn' | 'bun' | 'brew' | 'go' | 'uv' | 'download';

export interface SkillInstallSpec {
  /** Unique identifier for this install spec */
  id?: string;
  /** Installation method */
  kind: SkillInstallKind;
  /** Package name (for node/uv) */
  package?: string;
  /** Formula name (for brew) */
  formula?: string;
  /** Go module path (for go) */
  module?: string;
  /** Download URL (for download) */
  url?: string;
  /** Expected binaries after installation */
  bins?: string[];
  /** Human-readable label */
  label?: string;
  /** Platform restrictions */
  os?: Array<'darwin' | 'linux' | 'win32'>;
}

export interface SkillRequires {
  /** Required binaries */
  bins?: string[];
  /** Required environment variables */
  env?: string[];
  /** Any of these binaries (OR condition) */
  anyBins?: string[];
}

/** Parsed from `metadata.hermes` / `metadata.xopc` (Hermes-compatible tool gating). */
export interface SkillToolConditions {
  requiresTools: string[];
  requiresToolsets: string[];
  fallbackForTools: string[];
  fallbackForToolsets: string[];
}

export interface SkillMetadata {
  /** Skill name (from frontmatter) */
  name: string;
  /** Skill description (from frontmatter) */
  description: string;
  /** Emoji icon for UI */
  emoji?: string;
  /** Homepage URL */
  homepage?: string;
  /** Platform restrictions */
  os?: Array<'darwin' | 'linux' | 'win32'>;
  /** Requirements */
  requires?: SkillRequires;
  /** Installation specs */
  install?: SkillInstallSpec[];
  /** xopc-specific metadata (for future extensions) */
  xopc?: {
    emoji?: string;
    requires?: SkillRequires;
    install?: SkillInstallSpec[];
    os?: Array<'darwin' | 'linux' | 'win32'>;
    /**
     * Lazy capability packs to inject only when this skill is explicitly selected for a turn.
     * Parsed from `metadata.xopc.activates_capabilities`.
     */
    activatesCapabilities?: string[];
  };
}

// ============================================================================
// Skill Configuration
// ============================================================================

export interface SkillConfig {
  /** Whether the skill is enabled */
  enabled?: boolean;
  /** API key for the skill */
  apiKey?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Custom configuration */
  config?: Record<string, unknown>;
}

export interface SkillsLoadConfig {
  /** Additional skill folders to scan */
  extraDirs?: string[];
  /** Watch skill folders for changes */
  watch?: boolean;
  /** Debounce for the skills watcher (ms) */
  watchDebounceMs?: number;
}

export interface SkillsInstallConfig {
  /** Prefer brew for package installation */
  preferBrew?: boolean;
  /** Node package manager preference */
  nodeManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
}

export interface SkillsLimitsConfig {
  /** Max number of immediate child directories to consider */
  maxCandidatesPerRoot?: number;
  /** Max number of skills to load per source */
  maxSkillsLoadedPerSource?: number;
  /** Max number of skills to include in prompt */
  maxSkillsInPrompt?: number;
  /** Max characters for skills prompt */
  maxSkillsPromptChars?: number;
  /** Max size (bytes) for SKILL.md file */
  maxSkillFileBytes?: number;
}

export interface SkillsConfig {
  /** Bundled skill allowlist */
  allowBundled?: string[];
  /** Load configuration */
  load?: SkillsLoadConfig;
  /** Install configuration */
  install?: SkillsInstallConfig;
  /** Limits configuration */
  limits?: SkillsLimitsConfig;
  /** Per-skill configuration */
  entries?: Record<string, SkillConfig>;
  /**
   * When false, ignore requires_tools / toolset conditions for `<available_skills>` and skills_list (default: gate).
   */
  toolGating?: boolean;
  /**
   * Where `skill_manage` may create or edit skills: global `~/.xopc/skills`, workspace `.xopc/skills/`, or both.
   * Default `global`.
   */
  agentWritePolicy?: 'global' | 'workspace' | 'both';
}

// ============================================================================
// Skill Entry
// ============================================================================

export interface Skill {
  /** Skill name */
  name: string;
  /** Skill description */
  description: string;
  /** Category derived from parent directory (e.g. skills/creative/algorithmic-art → 'creative') */
  category?: string;
  /** Path to SKILL.md file */
  filePath: string;
  /** Base directory of the skill */
  baseDir: string;
  /** Source of the skill */
  source: 'builtin' | 'workspace' | 'global' | 'extra';
  /** Disable model invocation for this skill */
  disableModelInvocation: boolean;
  /** Parsed metadata */
  metadata: SkillMetadata;
  /** Optional Hermes-style visibility vs registered agent tools */
  toolConditions?: SkillToolConditions;
  /**
   * Declared env var names (`required_environment_variables`, `requires.env`, etc.) for session passthrough into shell / tools.
   */
  requiredEnvVarNames?: string[];
  /** Raw content of SKILL.md */
  content: string;
}

/** GET /api/skills/:name/content — body without YAML frontmatter plus parsed metadata for the gateway console. */
export interface SkillMarkdownPreviewPayload {
  name: string;
  description: string;
  bodyMarkdown: string;
  disableModelInvocation: boolean;
  metadata: SkillMetadata;
  toolConditions?: SkillToolConditions;
  requiredEnvVarNames?: string[];
}

export interface SkillEntry {
  skill: Skill;
  metadata: SkillMetadata;
  enabled: boolean;
  config?: SkillConfig;
}

export interface SkillEligibilityContext {
  /** Current platform */
  platform: string;
  /** Available binaries */
  hasBin: (bin: string) => boolean;
  /** Has any of these binaries */
  hasAnyBin: (bins: string[]) => boolean;
  /** Remote node context */
  remote?: {
    platforms: string[];
    hasBin: (bin: string) => boolean;
    hasAnyBin: (bins: string[]) => boolean;
    note?: string;
  };
}

// ============================================================================
// Skill Installation
// ============================================================================

export interface SkillInstallRequest {
  workspaceDir: string;
  skillName: string;
  installId: string;
  timeoutMs?: number;
}

export interface SkillInstallResult {
  /** Whether installation succeeded */
  ok: boolean;
  /** Human-readable message */
  message: string;
  /** stdout from install command */
  stdout: string;
  /** stderr from install command */
  stderr: string;
  /** Exit code */
  code: number | null;
  /** Warnings (e.g., security scan findings) */
  warnings?: string[];
}

// ============================================================================
// Skill Discovery
// ============================================================================

export interface LoadSkillsResult {
  skills: Skill[];
  prompt: string;
  diagnostics: SkillDiagnostic[];
}

export interface SkillDiagnostic {
  type: 'warning' | 'collision' | 'error';
  skillName?: string;
  message: string;
  path?: string;
}

export interface SkillRuntimeStatus {
  version: string;
  loadedAt: number;
  reloadInProgress: boolean;
  reloadPending: boolean;
  lastReloadStartedAt?: number;
  lastReloadFinishedAt?: number;
  lastReloadReason?: 'initial' | 'disk' | 'config';
  lastReloadOk?: boolean;
  lastReloadError?: string;
}

export interface SkillSnapshot {
  version: string;
  skills: SkillEntry[];
  loadedAt: number;
  workspaceDir: string;
}
