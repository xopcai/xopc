/**
 * System Prompt Builder - Builds the complete system prompt
 *
 * Combines base system prompt with skill prompts and profile Markdown.
 * This is the refactored version for AgentService modularization.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import type { SkillManager } from '../skills/skill-manager.js';
import { createSkillConfigManager } from '../skills/config.js';
import { selectSkillsVisibleInPrompt } from '../skills/format-skills-prompt.js';
import { resolveStateDir } from '../../config/paths.js';
import type { ProfileMarkdownFile } from '../context/workspace.js';
import { buildSystemPrompt as buildBaseSystemPrompt } from './system-prompt.js';
import { mergeTtsConfigFromAppConfig } from '../../voice/tts/merge-config.js';
import { buildTtsSystemPromptHint } from '../../voice/tts/directives.js';
import { toWorkspaceProfileMarkdownFile, DEFAULT_USER_FILENAME } from '../context/workspace.js';
import type { MemorySnapshot } from '../memory/types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SystemPromptBuilder');

export interface SystemPromptBuildOptions {
  curatedMemorySnapshot?: MemorySnapshot;
  externalMemoryInstructions?: string;
  /** Per-agent workspace (profile Markdown paths and base prompt). */
  workspaceOverride?: string;
  /** Canonical profile dir (`agents/<id>/profile/`); used for path hints and USER.md disk fallback. */
  profileMarkdownPathRoot?: string;
  /** When set, replaces the default base system prompt (skills still appended unless empty). */
  systemPromptOverride?: string;
  /** Explicit skill XML block; wins over {@link skillAllowlist}. */
  skillPromptText?: string;
  /** Restrict `<available_skills>` to these names (merged with skills.json toggles). */
  skillAllowlist?: string[];
  /** Registered tool names for this agent session (enables skill tool gating). */
  registeredToolNames?: string[];
}

export interface SystemPromptBuilderConfig {
  workspace: string;
  config: Config;
  skillManager: SkillManager;
}

/**
 * System Prompt Builder - Refactored for AgentService
 * 
 * This class builds the complete system prompt by combining:
 * 1. Base system prompt (from buildSystemPrompt)
 * 2. Skill prompts (from SkillManager)
 */
export class SystemPromptBuilder {
  private workspace: string;
  private config: Config;
  private skillManager: SkillManager;

  constructor(config: SystemPromptBuilderConfig) {
    this.workspace = config.workspace;
    this.config = config.config;
    this.skillManager = config.skillManager;
  }

  /**
   * Build the complete system prompt with all components
   */
  build(profileMarkdownFiles: ProfileMarkdownFile[], options?: SystemPromptBuildOptions): string {
    const ws = options?.workspaceOverride ?? this.workspace;
    const profilePathRoot = options?.profileMarkdownPathRoot ?? ws;

    if (options?.systemPromptOverride?.trim()) {
      const skillPrompt =
        options.skillPromptText !== undefined
          ? options.skillPromptText
          : this.skillManager.getPromptForSkillAllowlist(
              options.skillAllowlist,
              options.registeredToolNames,
            );
      const trimmed = options.systemPromptOverride.trim();
      let fullPrompt = skillPrompt.trim() ? `${trimmed}\n\n${skillPrompt}` : trimmed;
      const ttsMerged = mergeTtsConfigFromAppConfig(this.config.messages?.tts);
      const reg = options.registeredToolNames ?? [];
      const ttsHint = buildTtsSystemPromptHint({
        enabled: ttsMerged.enabled,
        trigger: ttsMerged.trigger,
        maxTextLength: ttsMerged.maxTextLength,
        modelOverrides: ttsMerged.modelOverrides,
        textToSpeechTool: ttsMerged.enabled && reg.includes('text_to_speech'),
      });
      if (ttsHint?.trim()) {
        fullPrompt = `${fullPrompt}\n\n## Voice (TTS)\n\n${ttsHint.trim()}`;
      }
      log.debug({ baseLength: trimmed.length, skillLength: skillPrompt.length, totalLength: fullPrompt.length }, 'System prompt built (override)');
      return fullPrompt;
    }

    const heartbeatEnabled = this.config.gateway?.heartbeat?.includeSystemPromptSection ?? false;

    const curatedMemorySnapshot = options?.curatedMemorySnapshot;
    const externalMemoryInstructions = options?.externalMemoryInstructions;
    const userTimezone = this.extractTimezone(
      profileMarkdownFiles,
      curatedMemorySnapshot?.user,
      ws,
      profilePathRoot,
    );

    const workspaceProfileMarkdownFiles = profileMarkdownFiles.map((f) =>
      toWorkspaceProfileMarkdownFile(f, profilePathRoot),
    );

    const ttsMerged = mergeTtsConfigFromAppConfig(this.config.messages?.tts);
    const reg = options?.registeredToolNames ?? [];
    const ttsSystemHint = buildTtsSystemPromptHint({
      enabled: ttsMerged.enabled,
      trigger: ttsMerged.trigger,
      maxTextLength: ttsMerged.maxTextLength,
      modelOverrides: ttsMerged.modelOverrides,
      textToSpeechTool: ttsMerged.enabled && reg.includes('text_to_speech'),
    });

    const basePrompt = buildBaseSystemPrompt(ws, {
      profileMarkdownFiles: workspaceProfileMarkdownFiles,
      heartbeatEnabled,
      availableTools: this.getSkillNamesForSkillsSection({
        skillAllowlist: options?.skillAllowlist,
        registeredToolNames: options?.registeredToolNames,
      }),
      userTimezone,
      curatedMemorySnapshot,
      externalMemoryInstructions,
      ttsSystemHint,
    });

    const skillPrompt =
      options?.skillPromptText !== undefined
        ? options.skillPromptText
        : this.skillManager.getPromptForSkillAllowlist(
            options?.skillAllowlist,
            options?.registeredToolNames,
          );

    const fullPrompt = skillPrompt ? `${basePrompt}\n\n${skillPrompt}` : basePrompt;

    log.debug(
      {
        baseLength: basePrompt.length,
        skillLength: skillPrompt?.length || 0,
        totalLength: fullPrompt.length,
      },
      'System prompt built',
    );

    return fullPrompt;
  }

  /**
   * Rebuild the system prompt with current skills
   */
  rebuild(profileMarkdownFiles: ProfileMarkdownFile[], options?: SystemPromptBuildOptions): string {
    this.skillManager.reload();
    return this.build(profileMarkdownFiles, options);
  }

  /**
   * Extract user timezone from curated snapshot, profile USER.md on disk, or loaded profile snapshot.
   */
  private extractTimezone(
    profileMarkdownFiles: ProfileMarkdownFile[],
    curatedUserBlock?: string,
    workspaceDir?: string,
    profilePathRoot?: string,
  ): string | undefined {
    const ws = workspaceDir ?? this.workspace;
    const prof = profilePathRoot ?? ws;
    if (curatedUserBlock?.trim()) {
      const m = curatedUserBlock.match(/Timezone:\s*(.+)/i);
      if (m) {
        return m[1].trim();
      }
    }

    const userFile = profileMarkdownFiles.find(f => f.name === DEFAULT_USER_FILENAME);
    if (userFile && !userFile.missing && userFile.content) {
      const match = userFile.content.match(/Timezone:\s*(.+)/i);
      if (match) {
        return match[1].trim();
      }
    }

    const primaryPath = join(prof, DEFAULT_USER_FILENAME);
    if (existsSync(primaryPath)) {
      try {
        const raw = readFileSync(primaryPath, 'utf-8');
        const match = raw.match(/Timezone:\s*(.+)/i);
        if (match) {
          return match[1].trim();
        }
      } catch {
        /* ignore */
      }
    }

    return undefined;
  }

  /** Skill names driving the "## Skills" section (aligned with `<available_skills>` indexing). */
  private getSkillNamesForSkillsSection(options?: {
    skillAllowlist?: string[];
    registeredToolNames?: string[];
  }): string[] {
    const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
    return selectSkillsVisibleInPrompt(this.skillManager.getSkills(), skillsConfig, {
      skillAllowlist: options?.skillAllowlist,
      registeredToolNames: options?.registeredToolNames,
    }).map((s) => s.name);
  }

  /**
   * Get just the skill prompt portion
   */
  getSkillPrompt(): string {
    return this.skillManager.getPrompt();
  }

  /**
   * Get the base system prompt without skills
   */
  getBasePrompt(
    profileMarkdownFiles: ProfileMarkdownFile[],
    options?: {
      curatedMemorySnapshot?: MemorySnapshot;
      externalMemoryInstructions?: string;
      workspaceOverride?: string;
      profileMarkdownPathRoot?: string;
    },
  ): string {
    const ws = options?.workspaceOverride ?? this.workspace;
    const profilePathRoot = options?.profileMarkdownPathRoot ?? ws;
    const workspaceProfileMarkdownFiles = profileMarkdownFiles.map((f) =>
      toWorkspaceProfileMarkdownFile(f, profilePathRoot),
    );

    const snap = options?.curatedMemorySnapshot;
    return buildBaseSystemPrompt(ws, {
      profileMarkdownFiles: workspaceProfileMarkdownFiles,
      heartbeatEnabled: this.config.gateway?.heartbeat?.includeSystemPromptSection ?? false,
      userTimezone: this.extractTimezone(profileMarkdownFiles, snap?.user, ws, profilePathRoot),
      curatedMemorySnapshot: snap,
      externalMemoryInstructions: options?.externalMemoryInstructions,
    });
  }
}

export { buildBaseSystemPrompt as buildSystemPrompt };

// Factory function for creating SystemPromptBuilder
export function createSystemPromptBuilder(config: SystemPromptBuilderConfig): SystemPromptBuilder {
  return new SystemPromptBuilder(config);
}

// Export config types
export type { SystemPromptBuilderConfig as SystemPromptConfig };
export type { SystemPromptBuilderConfig as SystemPromptBuilderOptions };
