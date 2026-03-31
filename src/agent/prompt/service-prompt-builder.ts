/**
 * System Prompt Builder - Builds the complete system prompt
 *
 * Combines base system prompt with skill prompts and bootstrap files.
 * This is the refactored version for AgentService modularization.
 */

import type { Config } from '../../config/schema.js';
import type { SkillManager } from '../skills/skill-manager.js';
import type { BootstrapFile } from '../context/workspace.js';
import { buildSystemPrompt as buildBaseSystemPrompt } from './system-prompt.js';
import { toWorkspaceBootstrapFile } from '../context/workspace.js';
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
  build(bootstrapFiles: BootstrapFile[]): string {
    // Check if heartbeat is enabled
    const heartbeatEnabled = this.config.gateway?.heartbeat?.enabled ?? false;
    
    // Extract user timezone from USER.md if available
    const userTimezone = this.extractTimezone(bootstrapFiles);
    
    // Convert bootstrap files to workspace format
    const workspaceBootstrapFiles = bootstrapFiles.map(f => 
      toWorkspaceBootstrapFile(f, this.workspace)
    );

    // Build base system prompt
    const basePrompt = buildBaseSystemPrompt(this.workspace, {
      bootstrapFiles: workspaceBootstrapFiles,
      heartbeatEnabled,
      availableTools: this.getAvailableTools(),
      userTimezone,
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
  rebuild(bootstrapFiles: BootstrapFile[]): string {
    // Reload skills first
    this.skillManager.reload();
    return this.build(bootstrapFiles);
  }

  /**
   * Extract user timezone from USER.md bootstrap file
   */
  private extractTimezone(bootstrapFiles: BootstrapFile[]): string | undefined {
    const userFile = bootstrapFiles.find(f => f.name === 'USER.md');
    if (!userFile || userFile.missing || !userFile.content) {
      return undefined;
    }

    const match = userFile.content.match(/Timezone:\s*(.+)/i);
    return match ? match[1].trim() : undefined;
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
  getBasePrompt(bootstrapFiles: BootstrapFile[]): string {
    const workspaceBootstrapFiles = bootstrapFiles.map(f => 
      toWorkspaceBootstrapFile(f, this.workspace)
    );

    return buildBaseSystemPrompt(this.workspace, {
      bootstrapFiles: workspaceBootstrapFiles,
      heartbeatEnabled: this.config.gateway?.heartbeat?.enabled ?? false,
      userTimezone: this.extractTimezone(bootstrapFiles),
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
