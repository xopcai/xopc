/**
 * Skill Manager - Manages skills loading and expansion
 *
 * Handles skill initialization, reloading, and command expansion.
 */

import { createSkillLoader } from './index.js';
import { resolveBundledSkillsDir, resolveStateDir } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';
import { createSkillConfigManager, isSkillEnabled } from './config.js';
import { formatSkillsForPrompt, selectSkillsVisibleInPrompt } from './format-skills-prompt.js';
import type {
  LoadSkillsResult,
  Skill,
  SkillDiagnostic,
  SkillRuntimeStatus,
} from './types.js';

const log = createLogger('SkillManager');
const SKILL_TOKEN_RE = /\/skill:([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export interface SkillLoadResult {
  skills: Skill[];
  prompt: string;
  diagnostics: SkillDiagnostic[];
}

export class SkillManager {
  private skillPrompt: string = '';
  private skills: Skill[] = [];
  private skillLoader = createSkillLoader();
  private workspace: string;
  private bundledSkillsDir: string;
  private version = 0;
  private loadedAt = 0;
  private reloadInProgress = false;
  private reloadPending = false;
  private lastReloadStartedAt: number | undefined;
  private lastReloadFinishedAt: number | undefined;
  private lastReloadReason: SkillRuntimeStatus['lastReloadReason'];
  private lastReloadOk: boolean | undefined;
  private lastReloadError: string | undefined;

  constructor(workspace: string, bundledSkillsDir?: string) {
    this.workspace = workspace;
    this.bundledSkillsDir = bundledSkillsDir || resolveBundledSkillsDir();
    this.initialize();
  }

  /**
   * Initialize skills from workspace and bundled directories
   */
  private initialize(): void {
    this.runReload('initial', () => this.skillLoader.init(this.workspace, this.bundledSkillsDir));
  }

  /**
   * Recompute skill XML prompt from current skills.json (no disk rescan).
   */
  refreshPromptFromConfig(): void {
    this.skillLoader.refreshPromptFromConfig();
    this.skillPrompt = this.skillLoader.getPrompt();
    this.version += 1;
    this.loadedAt = Date.now();
    this.lastReloadReason = 'config';
    this.lastReloadOk = true;
    this.lastReloadError = undefined;
  }

  /**
   * Reload skills from disk
   */
  reload(): void {
    this.runReload('disk', () => this.skillLoader.reload());
  }

  private runReload(reason: NonNullable<SkillRuntimeStatus['lastReloadReason']>, load: () => LoadSkillsResult): void {
    if (this.reloadInProgress) {
      this.reloadPending = true;
      return;
    }

    do {
      this.reloadPending = false;
      this.reloadInProgress = true;
      this.lastReloadStartedAt = Date.now();
      this.lastReloadReason = reason;
      try {
        const result = load();
        this.applyLoadResult(result);
        this.lastReloadOk = true;
        this.lastReloadError = undefined;
        log.info({ count: result.skills.length, version: this.version }, 'Skills reloaded');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.lastReloadOk = false;
        this.lastReloadError = errorMessage;
        log.error({ err, errorMessage }, `Skills reload failed: ${errorMessage}`);
      } finally {
        this.lastReloadFinishedAt = Date.now();
        this.reloadInProgress = false;
      }
    } while (this.reloadPending);
  }

  private applyLoadResult(result: LoadSkillsResult): void {
    this.skillPrompt = result.prompt;
    this.skills = result.skills;
    this.version += 1;
    this.loadedAt = Date.now();

    for (const diag of result.diagnostics) {
      if (diag.type === 'collision') {
        log.warn({ skill: diag.skillName, path: diag.path, message: diag.message }, 'Skill collision');
      } else if (diag.type === 'warning') {
        log.warn({ skill: diag.skillName, path: diag.path, message: diag.message }, 'Skill warning');
      } else if (diag.type === 'error') {
        log.error({ skill: diag.skillName, path: diag.path, message: diag.message }, 'Skill error');
      }
    }
  }

  /**
   * Get the skill prompt to append to system prompt
   */
  getPrompt(): string {
    return this.skillPrompt;
  }

  /**
   * `<available_skills>` XML with optional per-agent allowlist and/or tool-based gating.
   * When both arguments are omitted, returns the cached prompt from disk load (no tool gating).
   */
  getPromptForSkillAllowlist(
    allowlist: string[] | undefined,
    registeredToolNames?: string[],
  ): string {
    if (allowlist === undefined && registeredToolNames === undefined) {
      return this.getPrompt();
    }
    const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
    return formatSkillsForPrompt(this.getSkills(), skillsConfig, {
      skillAllowlist: allowlist,
      registeredToolNames,
    });
  }

  /** Skills visible for prompts and skills_list given the same indexing options as {@link getPromptForSkillAllowlist}. */
  selectSkillsForAgentIndexing(options?: {
    skillAllowlist?: string[];
    registeredToolNames?: string[];
  }): Skill[] {
    const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
    return selectSkillsVisibleInPrompt(this.getSkills(), skillsConfig, options);
  }

  /**
   * Get all loaded skills
   */
  getSkills(): Skill[] {
    return [...this.skills];
  }

  getDiagnostics(): SkillDiagnostic[] {
    return this.skillLoader.getDiagnostics();
  }

  getVersion(): string {
    return String(this.version);
  }

  getLoadedAt(): number {
    return this.loadedAt;
  }

  getStatus(): SkillRuntimeStatus {
    return {
      version: this.getVersion(),
      loadedAt: this.loadedAt,
      reloadInProgress: this.reloadInProgress,
      reloadPending: this.reloadPending,
      ...(this.lastReloadStartedAt !== undefined ? { lastReloadStartedAt: this.lastReloadStartedAt } : {}),
      ...(this.lastReloadFinishedAt !== undefined ? { lastReloadFinishedAt: this.lastReloadFinishedAt } : {}),
      ...(this.lastReloadReason !== undefined ? { lastReloadReason: this.lastReloadReason } : {}),
      ...(this.lastReloadOk !== undefined ? { lastReloadOk: this.lastReloadOk } : {}),
      ...(this.lastReloadError !== undefined ? { lastReloadError: this.lastReloadError } : {}),
    };
  }

  /**
   * Get skill names
   */
  getSkillNames(): string[] {
    return this.skills.map((s) => s.name);
  }

  /** Names of skills included in the agent system prompt (`<available_skills>`). */
  getSkillNamesForPrompt(): string[] {
    const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
    return this.getSkills()
      .filter((s) => !s.disableModelInvocation && isSkillEnabled(s, skillsConfig))
      .map((s) => s.name);
  }

  /**
   * Skills that are enabled for model discovery (respects skills.json and requirement checks).
   */
  getEnabledSkills(): Skill[] {
    const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
    return this.getSkills().filter(
      (s) => !s.disableModelInvocation && isSkillEnabled(s, skillsConfig),
    );
  }

  /**
   * Like {@link getEnabledSkills} plus optional allowlist and tool gating (matches `<available_skills>`).
   */
  getEnabledSkillsForAgentSession(options?: {
    skillAllowlist?: string[];
    registeredToolNames?: string[];
  }): Skill[] {
    return this.selectSkillsForAgentIndexing(options);
  }

  getActivatedCapabilitiesForText(
    text: string,
    options?: { skillAllowlist?: string[]; registeredToolNames?: string[] },
  ): string[] {
    if (!text.includes('/skill:')) return [];
    const selected = new Set<string>();
    for (const match of text.matchAll(SKILL_TOKEN_RE)) {
      if (match[1]) selected.add(match[1]);
    }
    if (selected.size === 0) return [];

    const visible = this.selectSkillsForAgentIndexing(options);
    const activeCapabilities = new Set<string>();
    for (const skill of visible) {
      if (!selected.has(skill.name)) continue;
      for (const capabilityName of skill.metadata.xopc?.activatesCapabilities ?? []) {
        const trimmed = capabilityName.trim();
        if (trimmed) activeCapabilities.add(trimmed);
      }
    }
    return [...activeCapabilities];
  }

  /**
   * Find a skill by name
   */
  findSkill(name: string): Skill | undefined {
    return this.skills.find(s => s.name === name);
  }

  /**
   * Check if a skill exists
   */
  hasSkill(name: string): boolean {
    return this.skills.some(s => s.name === name);
  }

  /**
   * Expand a skill command into a full skill block
   */
  expandCommand(text: string, options?: { skillAllowlist?: string[]; registeredToolNames?: string[] }): string {
    if (!text.startsWith('/skill:')) {
      return text;
    }

    const { skillName, args } = this.parseSkillCommand(text);
    const visible = this.selectSkillsForAgentIndexing(options);
    const skill = visible.find((s) => s.name === skillName);

    if (!skill) {
      log.warn({ skillName }, 'Skill not visible for expansion');
      return text;
    }

    return this.buildSkillBlock(skill, args);
  }

  /**
   * Parse a /skill: command
   */
  private parseSkillCommand(text: string): { skillName: string; args?: string } {
    // Format: /skill:name args...
    const withoutPrefix = text.slice(7); // Remove '/skill:'
    const spaceIndex = withoutPrefix.indexOf(' ');

    if (spaceIndex === -1) {
      return { skillName: withoutPrefix.trim() };
    }

    return {
      skillName: withoutPrefix.slice(0, spaceIndex).trim(),
      args: withoutPrefix.slice(spaceIndex + 1).trim(),
    };
  }

  /**
   * Build a skill block for inclusion in the prompt
   */
  private buildSkillBlock(skill: Skill, args?: string): string {
    let block = `\n\n## Skill: ${skill.name}\n\n`;
    
    if (skill.description) {
      block += `${skill.description}\n\n`;
    }

    // Include raw skill content (SKILL.md content)
    if (skill.content) {
      block += `${skill.content}\n\n`;
    }

    if (args) {
      block += `**Arguments**: ${args}\n\n`;
    }

    return block;
  }
}
