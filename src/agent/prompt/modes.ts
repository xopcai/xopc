// Layered Prompt Modes - Support for full/minimal/subagent/none modes
import { PromptBuilder, PromptConfig } from './index.js';

// =============================================================================
// Mode Configurations
// =============================================================================

export interface ModeConfig {
  name: string;
  description: string;
  sections: ('tools' | 'safety' | 'memory' | 'workspace' | 'skills' | 'subagents' | 'messaging' | 'heartbeat' | 'replyTags' | 'runtime')[];
  toolCallStyle: 'verbose' | 'brief' | 'minimal';
  includeReasoning: boolean;
  includeReplyTags: boolean;
}

export const PROMPT_MODES: Record<string, ModeConfig> = {
  full: {
    name: 'full',
    description: 'Complete prompt with all features enabled',
    sections: ['tools', 'safety', 'memory', 'workspace', 'skills', 'subagents', 'messaging', 'heartbeat', 'replyTags', 'runtime'],
    toolCallStyle: 'brief',
    includeReasoning: true,
    includeReplyTags: true,
  },
  minimal: {
    name: 'minimal',
    description: 'Lightweight prompt for quick interactions',
    sections: ['tools', 'safety', 'workspace'],
    toolCallStyle: 'brief',
    includeReasoning: false,
    includeReplyTags: false,
  },
  subagent: {
    name: 'subagent',
    description: 'Task-focused prompt for sub-agent sessions',
    sections: ['tools', 'safety', 'memory', 'workspace', 'subagents'],
    toolCallStyle: 'minimal',
    includeReasoning: false,
    includeReplyTags: false,
  },
  none: {
    name: 'none',
    description: 'Minimal identity only',
    sections: [],
    toolCallStyle: 'minimal',
    includeReasoning: false,
    includeReplyTags: false,
  },
};

// =============================================================================
// Mode Builder
// =============================================================================

export class ModePromptBuilder {
  private name: string = 'Cipher';
  private emoji: string = '🎯';
  private version: string = '1.0.0';

  setIdentity(name: string, emoji: string): this {
    this.name = name;
    this.emoji = emoji;
    return this;
  }

  setVersion(version: string): this {
    this.version = version;
    return this;
  }

  /**
   * Build prompt for a specific mode
   */
  buildForMode(
    mode: string,
    config: Omit<PromptConfig, 'mode'>
  ): string {
    const modeConfig = PROMPT_MODES[mode];
    if (!modeConfig) {
      throw new Error(`Unknown prompt mode: ${mode}`);
    }

    const builder = new PromptBuilder({ ...config, mode: mode as PromptConfig['mode'] });

    // Always include identity and version
    builder.addSection({
      content: `You are ${this.name} ${this.emoji}, running inside xopcbot v${this.version}.`,
      priority: 0,
    });

    // Add sections based on mode
    for (const section of modeConfig.sections) {
      switch (section) {
        case 'tools':
          builder.addSection({
            header: '## Tooling',
            content: 'Available tools are listed separately. Use them as needed.',
            priority: 10,
          });
          break;
        case 'safety':
          builder.addSection({
            header: '## Safety',
            content: [
              'Prioritize safety and human oversight.',
              'If instructions conflict, pause and ask.',
            ].join('\n'),
            priority: 20,
          });
          break;
        case 'memory':
          builder.addSection({
            header: '## Memory',
            content: 'Use memory files for continuity across sessions.',
            priority: 30,
          });
          break;
        case 'workspace':
          builder.addSection({
            header: '## Workspace',
            content: `Working directory: ${config.workspaceDir}`,
            priority: 40,
          });
          break;
        case 'skills':
          builder.addSection({
            header: '## Skills',
            content: 'Skills extend your capabilities.',
            priority: 50,
          });
          break;
        case 'subagents':
          builder.addSection({
            header: '## Subagents',
            content: 'Use spawn for complex/long-running tasks.',
            priority: 55,
          });
          break;
        case 'messaging':
          builder.addSection({
            header: '## Messaging',
            content: 'Reply in current session.',
            priority: 60,
          });
          break;
        case 'replyTags':
          if (modeConfig.includeReplyTags) {
            builder.addSection({
              header: '## Reply Tags',
              content: 'Use [[reply_to_current]] for quoted replies.',
              priority: 65,
            });
          }
          break;
        case 'heartbeat':
          if (config.heartbeatEnabled) {
            builder.addSection({
              header: '## Heartbeats',
              content: config.heartbeatPrompt 
                ? `Heartbeat: ${config.heartbeatPrompt}`
                : 'Heartbeats enabled.',
              priority: 70,
            });
          }
          break;
        case 'runtime':
          builder.addSection({
            header: '## Runtime',
            content: `xopcbot v${this.version}`,
            priority: 80,
          });
          break;
      }
    }

    return builder.build();
  }

  /**
   * Build full mode prompt
   */
  buildFull(config: Omit<PromptConfig, 'mode'>): string {
    return this.buildForMode('full', config);
  }

  /**
   * Build minimal mode prompt
   */
  buildMinimal(config: Omit<PromptConfig, 'mode'>): string {
    return this.buildForMode('minimal', config);
  }

  /**
   * Build subagent mode prompt
   */
  buildSubagent(task: string, config: Omit<PromptConfig, 'mode'>): string {
    const modeConfig = PROMPT_MODES['subagent'];
    const builder = new PromptBuilder({ ...config, mode: 'subagent' });

    builder.addSection({
      content: `You are ${this.name} ${this.emoji}, running inside xopcbot v${this.version}.`,
      priority: 0,
    });

    builder.addSection({
      header: '## Task',
      content: task,
      priority: 5,
    });

    for (const section of modeConfig.sections) {
      switch (section) {
        case 'tools':
          builder.addSection({
            header: '## Tooling',
            content: 'Execute the task using available tools.',
            priority: 10,
          });
          break;
        case 'safety':
          builder.addSection({
            header: '## Safety',
            content: 'Prioritize safety and human oversight.',
            priority: 20,
          });
          break;
        case 'memory':
          builder.addSection({
            header: '## Memory',
            content: 'Use memory for session continuity.',
            priority: 30,
          });
          break;
        case 'workspace':
          builder.addSection({
            header: '## Workspace',
            content: `Working directory: ${config.workspaceDir}`,
            priority: 40,
          });
          break;
        case 'subagents':
          builder.addSection({
            header: '## Subagents',
            content: 'Spawn subagents if needed.',
            priority: 55,
          });
          break;
      }
    }

    return builder.build();
  }

  /**
   * Build none mode prompt (identity only)
   */
  buildNone(): string {
    return `You are ${this.name} ${this.emoji}, running inside xopcbot v${this.version}.`;
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Create a mode builder with default identity
 */
export function createModeBuilder(): ModePromptBuilder {
  return new ModePromptBuilder();
}

/**
 * Get mode description
 */
export function getModeDescription(mode: string): string {
  const modeConfig = PROMPT_MODES[mode];
  return modeConfig?.description || 'Unknown mode';
}

/**
 * List all available modes
 */
export function listAvailableModes(): string[] {
  return Object.keys(PROMPT_MODES);
}
