// Prompt Builder - Modernized for efficiency (inspired by pi)
// Simplified and optimized for modern LLM capabilities
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

// =============================================================================
// Schema Definitions
// =============================================================================

export const PromptConfigSchema = Type.Object({
  mode: Type.Union([
    Type.Literal('full'),
    Type.Literal('minimal'),
    Type.Literal('none'),
  ], { default: 'full' }),
  workspaceDir: Type.String(),
  heartbeatEnabled: Type.Optional(Type.Boolean({ default: true })),
  heartbeatPrompt: Type.Optional(Type.String()),
  contextFiles: Type.Optional(Type.Array(Type.Object({
    name: Type.String(),
    content: Type.String(),
  }))),
});

export type PromptConfig = Static<typeof PromptConfigSchema>;

// =============================================================================
// Section Builders - Modernized
// =============================================================================

export interface PromptSection {
  header?: string;
  content: string;
  priority: number;
}

// Simplified identity - just who you are
export function buildIdentitySection(): PromptSection {
  return {
    content: `You are xopcbot, an ultra-efficient personal AI assistant.`,
    priority: 0,
  };
}

// Compact version info
export function buildVersionSection(version: string = '1.0.0'): PromptSection {
  return {
    content: `xopcbot v${version}`,
    priority: 1,
  };
}

// Simplified tool section - just list available tools
export function buildToolSection(availableTools: string[]): PromptSection {
  const toolsList = availableTools.length > 0 
    ? availableTools.map(t => `- ${t}`).join('\n')
    : '(none - use filesystem and shell)';

  return {
    header: '## Tools',
    content: toolsList,
    priority: 10,
  };
}

// Key guidelines - direct and concise (inspired by pi)
export function buildGuidelinesSection(): PromptSection {
  return {
    header: '## Guidelines',
    content: [
      'Call tools directly without narrating routine steps.',
      'Prioritize getting results over explaining process.',
      'Use tools proactively to accomplish goals.',
      'Be concise: value-dense responses preferred.',
      'Show file paths when working with files.',
      'Prefer read before edit.',
      'Prefer grep/find over bash for file exploration.',
    ].join('\n'),
    priority: 15,
  };
}

// Minimal safety - trust the LLM
export function buildSafetySection(): PromptSection {
  return {
    header: '## Guidelines (Safety)',
    content: [
      'Do not take independent actions that persist beyond the session.',
      'If asked to do something dangerous, refuse and explain why.',
    ].join('\n'),
    priority: 20,
  };
}

// Compact memory section
export function buildMemorySection(): PromptSection {
  return {
    header: '## Memory',
    content: [
      'Files provide continuity:',
      '- `memory/YYYY-MM-DD.md` — daily notes',
      '- `MEMORY.md` — long-term memory',
      'Before answering about prior work: memory_search → memory_get → cite sources.',
    ].join('\n'),
    priority: 30,
  };
}

export function buildWorkspaceSection(workspaceDir: string): PromptSection {
  return {
    content: `Working directory: ${workspaceDir}`,
    priority: 40,
  };
}

export function buildSkillsSection(hasSkills: boolean = false, skillsCount: number = 0): PromptSection {
  if (!hasSkills) {
    return { content: '', priority: 50 };
  }

  return {
    header: '## Skills',
    content: `${skillsCount} skill(s) loaded. Use /skill:name to activate.`,
    priority: 50,
  };
}

export function buildMessagingSection(channels: string[] = []): PromptSection {
  if (channels.length === 0) {
    return { content: '', priority: 60 };
  }

  return {
    header: '## Channels',
    content: `Active: ${channels.join(', ')}`,
    priority: 60,
  };
}

export interface ContextFile {
  name: string;
  content: string;
  missing?: boolean;
}

// Compact context files
export function buildContextFilesSection(contextFiles?: ContextFile[]): PromptSection {
  if (!contextFiles || contextFiles.length === 0) {
    return { content: '', priority: 90 };
  }

  const loadedFiles = contextFiles.filter(f => !f.missing);
  if (loadedFiles.length === 0) {
    return { content: '', priority: 90 };
  }

  const lines: string[] = ['## Project Context', ''];
  
  for (const file of loadedFiles) {
    // Only include first 2000 chars to avoid token bloat
    const content = file.content.length > 2000 
      ? file.content.slice(0, 2000) + '\n... (truncated)'
      : file.content;
    lines.push(`### ${file.name}`, '', content, '');
  }

  return {
    header: '',
    content: lines.join('\n'),
    priority: 90,
  };
}

export function buildHeartbeatSection(enabled: boolean, prompt?: string): PromptSection {
  if (!enabled) {
    return { content: '', priority: 70 };
  }

  return {
    header: '## Heartbeat',
    content: 'Poll for tasks. If nothing needs attention, reply: HEARTBEAT_OK',
    priority: 70,
  };
}

export function buildRuntimeSection(runtime: {
  version?: string;
  model?: string;
  channel?: string;
}): PromptSection {
  const parts: string[] = [];
  if (runtime.version) parts.push(`v${runtime.version}`);
  if (runtime.model) parts.push(`model=${runtime.model.split('/').pop()}`);
  if (runtime.channel) parts.push(`ch=${runtime.channel}`);

  return {
    content: parts.length > 0 ? `[${parts.join(' | ')}]` : '',
    priority: 80,
  };
}

// =============================================================================
// Main Prompt Builder - Simplified
// =============================================================================

export class PromptBuilder {
  private sections: Map<number, PromptSection> = new Map();

  constructor(private config: PromptConfig) {}

  addSection(section: PromptSection): this {
    this.sections.set(section.priority, section);
    return this;
  }

  build(): string {
    const lines: string[] = [];

    const sortedSections = Array.from(this.sections.values())
      .sort((a, b) => a.priority - b.priority);

    for (const section of sortedSections) {
      if (!section.content) continue;
      if (section.header) {
        lines.push(section.header, '');
      }
      lines.push(section.content, '');
    }

    return lines.filter(Boolean).join('\n');
  }

  static createFullPrompt(
    config: { workspaceDir: string },
    options: {
      version?: string;
      channels?: string[];
      skills?: { enabled: boolean; count: number };
      contextFiles?: ContextFile[];
      heartbeatEnabled?: boolean;
      heartbeatPrompt?: string;
    } = {}
  ): string {
    const builder = new PromptBuilder({ ...config, mode: 'full' });
    
    return builder
      .addSection(buildIdentitySection())
      .addSection(buildVersionSection(options.version))
      .addSection(buildGuidelinesSection())
      .addSection(buildSafetySection())
      .addSection(buildWorkspaceSection(config.workspaceDir))
      .addSection(buildMemorySection())
      .addSection(buildSkillsSection(options.skills?.enabled ?? false, options.skills?.count ?? 0))
      .addSection(buildMessagingSection(options.channels || []))
      .addSection(buildHeartbeatSection(options.heartbeatEnabled ?? true))
      .addSection(buildRuntimeSection({ 
        version: options.version,
      }))
      .addSection(buildContextFilesSection(options.contextFiles))
      .build();
  }

  static createMinimalPrompt(
    config: { workspaceDir: string },
    options: {
      contextFiles?: ContextFile[];
    } = {}
  ): string {
    const builder = new PromptBuilder({ ...config, mode: 'minimal' });
    
    return builder
      .addSection(buildIdentitySection())
      .addSection(buildGuidelinesSection())
      .addSection(buildWorkspaceSection(config.workspaceDir))
      .addSection(buildContextFilesSection(options.contextFiles))
      .build();
  }

  static createNonePrompt(): string {
    return `You are xopcbot, an efficient AI assistant.`;
  }
}

export * from './memory/index.js';
