/**
 * System Prompt Builder - Builds the complete system prompt
 *
 * Combines base system prompt with skill prompts and bootstrap files.
 * This is the refactored version for AgentService modularization.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import type { SkillManager } from '../skills/skill-manager.js';
import type { BootstrapFile } from '../context/workspace.js';
import { buildSystemPrompt as buildBaseSystemPrompt } from './system-prompt.js';
import { toWorkspaceBootstrapFile, DEFAULT_USER_FILENAME } from '../context/workspace.js';
import type { MemorySnapshot } from '../memory/types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SystemPromptBuilder');

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
  build(
    bootstrapFiles: BootstrapFile[],
    options?: { curatedMemorySnapshot?: MemorySnapshot },
  ): string {
    // Check if heartbeat is enabled
    const heartbeatEnabled = this.config.gateway?.heartbeat?.enabled ?? false;

    const curatedMemorySnapshot = options?.curatedMemorySnapshot;
    const userTimezone = this.extractTimezone(bootstrapFiles, curatedMemorySnapshot?.user);

    // Convert bootstrap files to workspace format
    const workspaceBootstrapFiles = bootstrapFiles.map(f =>
      toWorkspaceBootstrapFile(f, this.workspace),
    );

    // Build base system prompt
    const basePrompt = buildBaseSystemPrompt(this.workspace, {
      bootstrapFiles: workspaceBootstrapFiles,
      heartbeatEnabled,
      availableTools: this.getAvailableTools(),
      userTimezone,
      curatedMemorySnapshot,
    });

    // Get skill prompt
    const skillPrompt = this.skillManager.getPrompt();

    // Combine prompts
    const fullPrompt = skillPrompt 
      ? `${basePrompt}\n\n${skillPrompt}` 
      : basePrompt;

    log.debug({ 
      baseLength: basePrompt.length, 
      skillLength: skillPrompt?.length || 0,
      totalLength: fullPrompt.length 
    }, 'System prompt built');

    return fullPrompt;
  }

  /**
   * Rebuild the system prompt with current skills
   */
  rebuild(
    bootstrapFiles: BootstrapFile[],
    options?: { curatedMemorySnapshot?: MemorySnapshot },
  ): string {
    // Reload skills first
    this.skillManager.reload();
    return this.build(bootstrapFiles, options);
  }

  /**
   * Extract user timezone from curated snapshot, bootstrap USER.md, or workspace file.
   */
  private extractTimezone(
    bootstrapFiles: BootstrapFile[],
    curatedUserBlock?: string,
  ): string | undefined {
    if (curatedUserBlock?.trim()) {
      const m = curatedUserBlock.match(/Timezone:\s*(.+)/i);
      if (m) {
        return m[1].trim();
      }
    }

    const userFile = bootstrapFiles.find(f => f.name === DEFAULT_USER_FILENAME);
    if (userFile && !userFile.missing && userFile.content) {
      const match = userFile.content.match(/Timezone:\s*(.+)/i);
      if (match) {
        return match[1].trim();
      }
    }

    const path = join(this.workspace, DEFAULT_USER_FILENAME);
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf-8');
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

  /**
   * Get list of available tool names from skills
   */
  private getAvailableTools(): string[] {
    return this.skillManager.getSkillNamesForPrompt();
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
    bootstrapFiles: BootstrapFile[],
    options?: { curatedMemorySnapshot?: MemorySnapshot },
  ): string {
    const workspaceBootstrapFiles = bootstrapFiles.map(f =>
      toWorkspaceBootstrapFile(f, this.workspace),
    );

    const snap = options?.curatedMemorySnapshot;
    return buildBaseSystemPrompt(this.workspace, {
      bootstrapFiles: workspaceBootstrapFiles,
      heartbeatEnabled: this.config.gateway?.heartbeat?.enabled ?? false,
      userTimezone: this.extractTimezone(bootstrapFiles, snap?.user),
      curatedMemorySnapshot: snap,
    });
  }
}

// Re-export the original buildSystemPrompt for compatibility
export { buildBaseSystemPrompt as buildSystemPrompt };

// Factory function for creating SystemPromptBuilder
export function createSystemPromptBuilder(config: SystemPromptBuilderConfig): SystemPromptBuilder {
  return new SystemPromptBuilder(config);
}

// Export config types
export type { SystemPromptBuilderConfig as SystemPromptConfig };
export type { SystemPromptBuilderConfig as SystemPromptBuilderOptions };
