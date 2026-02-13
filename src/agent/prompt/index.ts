// Prompt Builder - Modular system prompt construction
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
// Section Builders
// =============================================================================

export interface PromptSection {
  header?: string;
  content: string;
  priority: number;
}

export function buildIdentitySection(): PromptSection {
  return {
    content: `You are a personal assistant running in xopcbot.`,
    priority: 0,
  };
}

export function buildVersionSection(version: string = '1.0.0'): PromptSection {
  return {
    header: '## Version',
    content: `xopcbot v${version}`,
    priority: 1,
  };
}

export function buildToolSection(availableTools: string[]): PromptSection {
  const toolsList = availableTools.length > 0 
    ? availableTools.map(t => `- ${t}`).join('\n')
    : 'No custom tools available. Use standard filesystem and shell tools.';

  return {
    header: '## Tooling',
    content: [
      'Tool availability (filtered by policy):',
      'Tool names are case-sensitive. Call tools exactly as listed.',
      '',
      toolsList,
    ].join('\n'),
    priority: 10,
  };
}

export function buildToolCallStyleSection(style: 'verbose' | 'brief' | 'minimal' = 'brief'): PromptSection {
  const content = {
    verbose: [
      'Always narrate your tool calls to help the user understand your process.',
      'Explain what you are doing before and after each tool call.',
      'Provide context for complex operations.',
    ].join('\n'),
    brief: [
      'Default: do not narrate routine, low-risk tool calls (just call the tool).',
      'Narrate only when it helps: multi-step work, complex problems, or when the user asks.',
      'Keep narration brief and value-dense.',
    ].join('\n'),
    minimal: [
      'Call tools as needed without narration.',
    ].join('\n'),
  };

  return {
    header: '## Tool Call Style',
    content: content[style],
    priority: 15,
  };
}

export function buildSafetySection(): PromptSection {
  return {
    header: '## Safety',
    content: [
      'You have no independent goals: do not pursue self-preservation, replication, or power-seeking.',
      'Prioritize safety and human oversight over completion.',
      'If instructions conflict, pause and ask.',
      'Comply with stop/pause/audit requests and never bypass safeguards.',
      'Do not manipulate or persuade anyone to expand access or disable safeguards.',
      'Do not copy yourself or change system prompts unless explicitly requested.',
    ].join('\n'),
    priority: 20,
  };
}

export function buildMemorySection(): PromptSection {
  return {
    header: '## Memory',
    content: [
      'Each session, you wake up fresh. These files are your continuity:',
      '',
      '**Daily notes:** `memory/YYYY-MM-DD.md` — raw logs of what happened',
      '**Long-term:** `MEMORY.md` — your curated memories',
      '',
      'Before answering questions about prior work, decisions, or preferences:',
      '1. Run memory_search to find relevant context',
      '2. Use memory_get to pull only needed lines',
      '3. Cite sources with `Source: <path>#<line>` when helpful',
      '',
      'Write significant events to memory files. Text > Brain.',
    ].join('\n'),
    priority: 30,
  };
}

export function buildWorkspaceSection(workspaceDir: string): PromptSection {
  return {
    header: '## Workspace',
    content: `Your working directory is: ${workspaceDir}`,
    priority: 40,
  };
}

export function buildSkillsSection(hasSkills: boolean = false, skillsCount: number = 0): PromptSection {
  if (!hasSkills) {
    return {
      content: 'Skills system available.',
      priority: 50,
    };
  }

  return {
    header: '## Skills',
    content: [
      'Skills are modular packages that extend your capabilities.',
      `Currently loaded: ${skillsCount} skill(s).`,
      'Use skills when the user needs specialized functionality.',
      'Skills are loaded from: `skills/` directory.',
    ].join('\n'),
    priority: 50,
  };
}

export function buildMessagingSection(channels: string[] = []): PromptSection {
  const channelList = channels.length > 0 ? channels.join(', ') : 'configured channels';

  return {
    header: '## Messaging',
    content: [
      `Available channels: ${channelList}`,
      'Reply in current session → routes to the source channel.',
      'Never use exec/curl for provider messaging.',
    ].join('\n'),
    priority: 60,
  };
}

export interface ContextFile {
  name: string;
  content: string;
  missing?: boolean;
}

export function buildContextFilesSection(
  contextFiles?: ContextFile[]
): PromptSection {
  if (!contextFiles || contextFiles.length === 0) {
    return { content: '', priority: 90 };
  }

  const loadedFiles = contextFiles.filter(f => !f.missing);
  const missingFiles = contextFiles.filter(f => f.missing);
  const hasSoul = loadedFiles.some(f => f.name.toLowerCase() === 'soul.md');

  const lines: string[] = [];
  lines.push('# Project Context', '');

  if (loadedFiles.length > 0) {
    lines.push('The following project context files have been loaded:');

    if (hasSoul) {
      lines.push('If SOUL.md is present, embody its persona and tone.');
    }

    lines.push('');

    for (const file of loadedFiles) {
      lines.push(`## ${file.name}`, '', file.content, '');
    }
  }

  if (missingFiles.length > 0) {
    if (loadedFiles.length > 0) {
      lines.push('');
    }
    lines.push('## Missing Files', '');
    lines.push('The following files are not yet created (run `xopcbot onboard` or create them manually):');
    lines.push('');

    for (const file of missingFiles) {
      lines.push(`- ${file.name}: ${file.content}`);
    }
    lines.push('');
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
    header: '## Heartbeats',
    content: [
      'Heartbeats enable proactive monitoring.',
      prompt ? `Heartbeat prompt: ${prompt}` : 'Heartbeat prompt: (configured)',
      'When polling and nothing needs attention, reply: HEARTBEAT_OK',
      'Only reply with alerts when something needs attention.',
    ].join('\n'),
    priority: 70,
  };
}

export function buildRuntimeSection(runtime: {
  version?: string;
  os?: string;
  node?: string;
  model?: string;
  channel?: string;
  thinking?: string;
}): PromptSection {
  const parts: string[] = [];
  
  if (runtime.version) parts.push(`v${runtime.version}`);
  if (runtime.os) parts.push(`os=${runtime.os}`);
  if (runtime.node) parts.push(`node=${runtime.node}`);
  if (runtime.model) parts.push(`model=${runtime.model}`);
  if (runtime.channel) parts.push(`channel=${runtime.channel}`);
  if (runtime.thinking) parts.push(`thinking=${runtime.thinking}`);

  return {
    header: '## Runtime',
    content: `xopcbot ${parts.join(' | ')}`,
    priority: 80,
  };
}

// =============================================================================
// Main Prompt Builder
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

    // Sort sections by priority and build
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
    
    // Identity
    builder.addSection(buildIdentitySection());

    // Version
    if (options.version) {
      builder.addSection(buildVersionSection(options.version));
    }

    return builder
      .addSection(buildToolCallStyleSection('brief'))
      .addSection(buildSafetySection())
      .addSection(buildMemorySection())
      .addSection(buildWorkspaceSection(config.workspaceDir))
      .addSection(buildSkillsSection(options.skills?.enabled ?? false, options.skills?.count ?? 0))
      .addSection(buildMessagingSection(options.channels || []))
      .addSection(buildHeartbeatSection(options.heartbeatEnabled ?? true, options.heartbeatPrompt))
      .addSection(buildRuntimeSection({ 
        version: options.version,
        thinking: 'off',
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
    
    builder.addSection(buildIdentitySection());
    
    return builder
      .addSection(buildSafetySection())
      .addSection(buildWorkspaceSection(config.workspaceDir))
      .addSection(buildContextFilesSection(options.contextFiles))
      .build();
  }

  static createNonePrompt(): string {
    return `You are a personal assistant running in xopcbot.`;
  }
}

// Re-export memory system (for memory_search/memory_get tools)
export * from './memory/index.js';

