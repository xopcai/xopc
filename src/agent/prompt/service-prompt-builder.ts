/**
 * System Prompt Builder - Builds the complete system prompt
 *
 * Combines base system prompt with skill prompts and bootstrap Project Context.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import type { EmbeddedContextFile } from '../bootstrap/types.js';
import { DEFAULT_USER_FILENAME } from '../context/workspace.js';
import type { SkillManager } from '../skills/skill-manager.js';
import { createSkillConfigManager } from '../skills/config.js';
import { selectSkillsVisibleInPrompt } from '../skills/format-skills-prompt.js';
import { resolveStateDir } from '../../config/paths.js';
import { buildSystemPrompt as buildBaseSystemPrompt } from './system-prompt.js';
import { mergeTtsConfigFromAppConfig } from '../../voice/tts/merge-config.js';
import { buildTtsSystemPromptHint } from '../../voice/tts/directives.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SystemPromptBuilder');

export interface SystemPromptBuildOptions {
  externalMemoryInstructions?: string;
  workspaceOverride?: string;
  profileMarkdownPathRoot?: string;
  systemPromptOverride?: string;
  skillPromptText?: string;
  skillAllowlist?: string[];
  registeredToolNames?: string[];
}

export interface SystemPromptBuilderConfig {
  workspace: string;
  config: Config;
  skillManager: SkillManager;
}

export class SystemPromptBuilder {
  private workspace: string;
  private config: Config;
  private skillManager: SkillManager;

  constructor(config: SystemPromptBuilderConfig) {
    this.workspace = config.workspace;
    this.config = config.config;
    this.skillManager = config.skillManager;
  }

  build(contextFiles: EmbeddedContextFile[], options: SystemPromptBuildOptions): string {
    const ws = options.workspaceOverride ?? this.workspace;
    const profilePathRoot = options.profileMarkdownPathRoot ?? ws;

    if (options.systemPromptOverride?.trim()) {
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
    const userTimezone = this.extractTimezone(contextFiles, profilePathRoot);

    const ttsMerged = mergeTtsConfigFromAppConfig(this.config.messages?.tts);
    const reg = options.registeredToolNames ?? [];
    const ttsSystemHint = buildTtsSystemPromptHint({
      enabled: ttsMerged.enabled,
      trigger: ttsMerged.trigger,
      maxTextLength: ttsMerged.maxTextLength,
      modelOverrides: ttsMerged.modelOverrides,
      textToSpeechTool: ttsMerged.enabled && reg.includes('text_to_speech'),
    });

    const basePrompt = buildBaseSystemPrompt(ws, {
      contextFiles,
      heartbeatEnabled,
      availableTools: this.getSkillNamesForSkillsSection({
        skillAllowlist: options.skillAllowlist,
        registeredToolNames: options.registeredToolNames,
      }),
      userTimezone,
      externalMemoryInstructions: options.externalMemoryInstructions,
      ttsSystemHint,
    });

    const skillPrompt =
      options.skillPromptText !== undefined
        ? options.skillPromptText
        : this.skillManager.getPromptForSkillAllowlist(
            options.skillAllowlist,
            options.registeredToolNames,
          );

    const fullPrompt = skillPrompt ? `${basePrompt}\n\n${skillPrompt}` : basePrompt;

    log.debug(
      {
        baseLength: basePrompt.length,
        skillLength: skillPrompt?.length || 0,
        totalLength: fullPrompt.length,
        contextFileCount: contextFiles.length,
      },
      'System prompt built',
    );

    return fullPrompt;
  }

  rebuild(contextFiles: EmbeddedContextFile[], options: SystemPromptBuildOptions): string {
    this.skillManager.reload();
    return this.build(contextFiles, options);
  }

  private extractTimezone(contextFiles: EmbeddedContextFile[], profilePathRoot: string): string | undefined {
    const userContext = contextFiles.find((file) =>
      file.path.replace(/\\/g, '/').toLowerCase().endsWith('/user.md'),
    );
    if (userContext?.content) {
      const match = userContext.content.match(/Timezone:\s*(.+)/i);
      if (match) {
        return match[1].trim();
      }
    }

    const primaryPath = join(profilePathRoot, DEFAULT_USER_FILENAME);
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

  getSkillPrompt(): string {
    return this.skillManager.getPrompt();
  }

  getBasePrompt(
    contextFiles: EmbeddedContextFile[],
    options?: {
      externalMemoryInstructions?: string;
      workspaceOverride?: string;
      profileMarkdownPathRoot?: string;
    },
  ): string {
    const ws = options?.workspaceOverride ?? this.workspace;
    const profilePathRoot = options?.profileMarkdownPathRoot ?? ws;
    return buildBaseSystemPrompt(ws, {
      contextFiles,
      heartbeatEnabled: this.config.gateway?.heartbeat?.includeSystemPromptSection ?? false,
      userTimezone: this.extractTimezone(contextFiles, profilePathRoot),
      externalMemoryInstructions: options?.externalMemoryInstructions,
    });
  }
}

export function createSystemPromptBuilder(config: SystemPromptBuilderConfig): SystemPromptBuilder {
  return new SystemPromptBuilder(config);
}

export type { SystemPromptBuilderConfig as SystemPromptConfig };
export type { SystemPromptBuilderConfig as SystemPromptBuilderOptions };
