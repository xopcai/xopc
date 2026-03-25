/**
 * System Prompt Builder - Enhanced version with workspace context integration
 * 
 * Integrates workspace bootstrap files:
 * - SOUL.md for persona and tone
 * - USER.md for user context
 * - IDENTITY.md for agent identity
 * - HEARTBEAT.md for task polling
 * - MEMORY.md for long-term memory
 * - Memory search integration in prompt
 */

import type { WorkspaceBootstrapFile } from '../context/workspace.js';
import {
  DEFAULT_SOUL_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  stripFrontMatter,
} from '../context/workspace.js';

// =============================================================================
// Configuration (Internal)
// =============================================================================

/** Maximum characters to inject from workspace files into system prompt */
const PROMPT_MAX_CHARS = {
  SOUL: 8_000,
  USER: 4_000,
  IDENTITY: 2_000,
  AGENTS: 20_000,
  TOOLS: 4_000,
  HEARTBEAT: 2_000,
  MEMORY: 8_000,
};

/** Whether memory citation is enabled */
export type MemoryCitationsMode = 'on' | 'off' | 'source-only';

export interface SystemPromptOptions {
  /** Workspace bootstrap files */
  bootstrapFiles: WorkspaceBootstrapFile[];
  /** Whether this is a subagent or cron job (reduced context) */
  isMinimal?: boolean;
  /** Whether heartbeat is enabled */
  heartbeatEnabled?: boolean;
  /** Custom heartbeat prompt */
  heartbeatPrompt?: string;
  /** Available tool names for skill matching */
  availableTools?: string[];
  /** Memory citations mode */
  memoryCitationsMode?: MemoryCitationsMode;
  /** User timezone for date/time display */
  userTimezone?: string;
  /** Runtime info (version, model, channel) */
  runtime?: {
    version?: string;
    model?: string;
    channel?: string;
  };
  /** Active messaging channels */
  channels?: string[];
}

// =============================================================================
// Section Builders
// =============================================================================

/**
 * Build SOUL.md section - persona and tone
 * 
 * If SOUL.md is present, embody its persona and tone
 */
function buildSoulSection(bootstrapFiles: WorkspaceBootstrapFile[]): string {
  const soulFile = bootstrapFiles.find(f => f.name === DEFAULT_SOUL_FILENAME);
  if (!soulFile || soulFile.missing || !soulFile.content) {
    return '';
  }

  // Strip front matter and truncate
  const content = stripFrontMatter(soulFile.content);
  const truncated = truncateForPrompt(content, PROMPT_MAX_CHARS.SOUL);

  return `## SOUL.md - Your Persona

${truncated}

_Embody this persona unless higher-priority instructions override it._
`;
}

/**
 * Build USER.md section - user context
 */
function buildUserSection(bootstrapFiles: WorkspaceBootstrapFile[]): string {
  const userFile = bootstrapFiles.find(f => f.name === DEFAULT_USER_FILENAME);
  if (!userFile || userFile.missing || !userFile.content) {
    return '';
  }

  const content = stripFrontMatter(userFile.content);
  const truncated = truncateForPrompt(content, PROMPT_MAX_CHARS.USER);

  return `## USER.md - About Your Human

${truncated}

_Use this context to provide personalized assistance._
`;
}

/**
 * Build IDENTITY.md section - agent identity
 */
function buildIdentitySection(bootstrapFiles: WorkspaceBootstrapFile[]): string {
  const identityFile = bootstrapFiles.find(f => f.name === DEFAULT_IDENTITY_FILENAME);
  if (!identityFile || identityFile.missing || !identityFile.content) {
    return '';
  }

  const content = stripFrontMatter(identityFile.content);
  const truncated = truncateForPrompt(content, PROMPT_MAX_CHARS.IDENTITY);

  return `## IDENTITY.md - Who You Are

${truncated}
`;
}

/**
 * Build AGENTS.md section - development guidelines
 */
function buildAgentsSection(bootstrapFiles: WorkspaceBootstrapFile[]): string {
  const agentsFile = bootstrapFiles.find(f => f.name === DEFAULT_AGENTS_FILENAME);
  if (!agentsFile || agentsFile.missing || !agentsFile.content) {
    return '';
  }

  const content = stripFrontMatter(agentsFile.content);
  const truncated = truncateForPrompt(content, PROMPT_MAX_CHARS.AGENTS);

  return `## AGENTS.md - Development Guidelines

${truncated}
`;
}

/**
 * Build TOOLS.md section - local tool notes
 */
function buildToolsSection(bootstrapFiles: WorkspaceBootstrapFile[]): string {
  const toolsFile = bootstrapFiles.find(f => f.name === DEFAULT_TOOLS_FILENAME);
  if (!toolsFile || toolsFile.missing || !toolsFile.content) {
    return '';
  }

  const content = stripFrontMatter(toolsFile.content);
  const truncated = truncateForPrompt(content, PROMPT_MAX_CHARS.TOOLS);

  return `## TOOLS.md - Local Notes

${truncated}
`;
}

/**
 * Build HEARTBEAT.md section - task polling
 */
function buildHeartbeatSection(
  bootstrapFiles: WorkspaceBootstrapFile[],
  enabled: boolean,
  customPrompt?: string,
  userTimezone?: string
): string {
  if (!enabled) {
    return '';
  }

  // If custom prompt provided, use it
  if (customPrompt) {
    return `## Heartbeat

${customPrompt}
`;
  }

  // Try to load from HEARTBEAT.md
  const heartbeatFile = bootstrapFiles.find(f => f.name === DEFAULT_HEARTBEAT_FILENAME);
  if (!heartbeatFile || heartbeatFile.missing || !heartbeatFile.content) {
    // Default heartbeat behavior with timezone-aware quiet hours
    let quietHoursNote = '';
    if (userTimezone) {
      quietHoursNote = `\n\n> 💤 Quiet hours: The user is in **${userTimezone}**. Avoid proactive checks during late night (23:00-08:00) unless urgent.`;
    }
    return `## Heartbeat

Poll for tasks. If nothing needs attention, reply: HEARTBEAT_OK

_Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats._${quietHoursNote}
`;
  }

  const content = stripFrontMatter(heartbeatFile.content);
  const truncated = truncateForPrompt(content, PROMPT_MAX_CHARS.HEARTBEAT);

  let quietHoursNote = '';
  if (userTimezone) {
    quietHoursNote = `\n\n> 💤 Quiet hours: The user is in **${userTimezone}**. Avoid proactive checks during late night (23:00-08:00) unless urgent.`;
  }

  return `## HEARTBEAT.md - Task Checklist

${truncated}

_Read HEARTBEAT.md for current tasks. If nothing needs attention, reply: HEARTBEAT_OK_${quietHoursNote}
`;
}

/**
 * Build Memory section - recall instructions
 * 
 * Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search
 */
function buildMemorySection(
  bootstrapFiles: WorkspaceBootstrapFile[],
  citationsMode: MemoryCitationsMode = 'on'
): string {
  // Check if memory files exist
  const memoryFile = bootstrapFiles.find(f => f.name === DEFAULT_MEMORY_FILENAME);
  const hasMemory = memoryFile && !memoryFile.missing;

  if (!hasMemory) {
    return '';
  }

  const citationInstruction = citationsMode === 'off'
    ? 'Citations are disabled: do not mention file paths or line numbers in replies.'
    : citationsMode === 'source-only'
    ? 'Citations: mention file path when it helps (e.g., Source: MEMORY.md).'
    : 'Citations: include Source: <path#line> when it helps the user verify memory snippets.';

  return `## Memory Recall

${citationInstruction}

Before answering anything about prior work, decisions, dates, people, preferences, or todos:
1. Run \`memory_search\` on MEMORY.md + memory/*.md
2. Use \`memory_get\` to pull only the needed lines
3. If low confidence after search, say you checked

### Memory Files

- **Daily notes:** \`memory/YYYY-MM-DD.md\` — raw logs of what happened
- **Long-term:** \`MEMORY.md\` — your curated memories, like a human's long-term memory

### Writing to Memory

- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- "Mental notes" don't survive session restarts. Files do.
- When someone says "remember this" → update \`memory/YYYY-MM-DD.md\` or relevant file
- When you learn a lesson → update relevant files
- When you make a mistake → document it so future-you doesn't repeat it
- **Text > Brain** 📝
`;
}

/**
 * Build Skills section - mandatory skill matching
 */
function buildSkillsSection(availableTools: string[] = []): string {
  if (availableTools.length === 0) {
    return '';
  }

  return `## Skills (mandatory)

Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location> with \`read\`, then follow it.
- If multiple could apply: choose the most specific one, then read/follow it.
- If none clearly apply: do not read any SKILL.md.
Constraints: never read more than one skill up front; only read after selecting.
`;
}

/**
 * Build Problem Solving Workflow section
 *
 * Implements the "Build & Self-Verify" pattern from harness engineering.
 * Guides agents through an iterative problem-solving process with verification.
 *
 * Inspired by: https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
 */
function buildProblemSolvingSection(): string {
  return `## Problem Solving Workflow

Follow this iterative process for all tasks:

### 1. Plan
- Read and understand the task requirements
- Explore the codebase to understand context
- Create a plan: what needs to change and why
- Identify how you will verify the solution

### 2. Build
- Implement your solution incrementally
- Write tests if they don't exist (happy path + edge cases)
- Make small, focused changes
- Document your changes as you go

### 3. Verify
- Run tests and checks
- Read the full output, don't just skim
- Compare results against requirements (not against your code)
- Test edge cases explicitly

### 4. Fix (if needed)
- Analyze any errors or failures
- Revisit the original requirements
- Fix issues and re-verify
- Iterate until requirements are met

### Before Declaring Complete
You MUST verify:
- [ ] All requirements from the original task are met
- [ ] Tests pass (if available)
- [ ] Edge cases are handled
- [ ] No regressions introduced

**Never skip verification. Models that verify their work perform significantly better.**`;
}

/**
 * Build Messaging section - channel-specific instructions
 */
function buildMessagingSection(
  channels: string[] = [],
  isMinimal: boolean = false
): string {
  if (isMinimal || channels.length === 0) {
    return '';
  }

  const channelList = channels.join(', ');

  return `## Messaging

- Reply in current session → automatically routes to the source channel (${channelList})
- Use \`message\` for proactive sends + channel actions
- If you use \`message\` to deliver your user-visible reply, respond with ONLY: NO_REPLY (avoid duplicate replies)
`;
}

/**
 * Build Time section - user timezone
 */
function buildTimeSection(timezone?: string): string {
  if (!timezone) {
    return '';
  }

  return `## Current Date & Time

Time zone: ${timezone}
`;
}

/**
 * Build Runtime section - version info
 */
function buildRuntimeSection(runtime?: { version?: string; model?: string; channel?: string }): string {
  if (!runtime) {
    return '';
  }

  const parts: string[] = [];
  if (runtime.version) parts.push(`v${runtime.version}`);
  if (runtime.model) parts.push(`model=${runtime.model.split('/').pop()}`);
  if (runtime.channel) parts.push(`ch=${runtime.channel}`);

  return parts.length > 0 ? `[${parts.join(' | ')}]` : '';
}

/**
 * Build Working Directory section
 */
function buildWorkingDirSection(workspaceDir: string): string {
  return `Working directory: ${workspaceDir}`;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Truncate content for prompt injection
 * Keeps head and tail to preserve context
 */
function truncateForPrompt(content: string, maxChars: number): string {
  const trimmed = content.trimEnd();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  // Keep head (70%) and tail (20%) with marker
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = Math.floor(maxChars * 0.2);
  const head = trimmed.slice(0, headChars);
  const tail = trimmed.slice(-tailChars);

  return `${head}

[...]${tail}`;
}

// =============================================================================
// Main Builder
// =============================================================================

/**
 * Build system prompt with workspace context integration
 * 
 * Injects workspace files at appropriate positions in the system prompt.
 */
export function buildSystemPrompt(
  workspaceDir: string,
  options: SystemPromptOptions
): string {
  const {
    bootstrapFiles,
    isMinimal = false,
    heartbeatEnabled = false,
    heartbeatPrompt,
    availableTools = [],
    memoryCitationsMode = 'on',
    userTimezone,
    runtime,
    channels = [],
  } = options;

  const sections: string[] = [];

  // 1. Identity and persona (non-minimal only)
  if (!isMinimal) {
    sections.push(buildIdentitySection(bootstrapFiles));
    sections.push(buildSoulSection(bootstrapFiles));
  }

  // 2. User context (non-minimal only)
  if (!isMinimal) {
    sections.push(buildUserSection(bootstrapFiles));
  }

  // 3. Time (non-minimal only)
  if (!isMinimal) {
    sections.push(buildTimeSection(userTimezone));
  }

  // 4. Memory section (non-minimal only)
  if (!isMinimal) {
    sections.push(buildMemorySection(bootstrapFiles, memoryCitationsMode));
  }

  // 5. Skills
  sections.push(buildSkillsSection(availableTools));

  // 6. Problem Solving Workflow (non-minimal only) - Harness Engineering
  if (!isMinimal) {
    sections.push(buildProblemSolvingSection());
  }

  // 7. Heartbeat
  sections.push(buildHeartbeatSection(bootstrapFiles, heartbeatEnabled, heartbeatPrompt, userTimezone));

  // 8. Working directory
  sections.push(buildWorkingDirSection(workspaceDir));

  // 9. Tools (non-minimal only)
  if (!isMinimal) {
    sections.push(buildToolsSection(bootstrapFiles));
  }

  // 10. Agents guidelines
  sections.push(buildAgentsSection(bootstrapFiles));

  // 10. Messaging
  sections.push(buildMessagingSection(channels, isMinimal));

  // 11. Runtime info
  sections.push(buildRuntimeSection(runtime));

  // Filter out empty sections and join
  return sections.filter(Boolean).join('\n\n');
}

/**
 * Build minimal system prompt for subagents/cron jobs (Internal)
 */
function _buildMinimalSystemPrompt(
  workspaceDir: string,
  bootstrapFiles: WorkspaceBootstrapFile[]
): string {
  return buildSystemPrompt(workspaceDir, {
    bootstrapFiles,
    isMinimal: true,
    heartbeatEnabled: false,
  });
}

/**
 * Get bootstrap file by name (Internal)
 */
function _getBootstrapFile(
  bootstrapFiles: WorkspaceBootstrapFile[],
  name: string
): WorkspaceBootstrapFile | undefined {
  return bootstrapFiles.find(f => f.name === name);
}

/**
 * Check if specific bootstrap file exists and is loaded (Internal)
 */
function _hasBootstrapFile(
  bootstrapFiles: WorkspaceBootstrapFile[],
  name: string
): boolean {
  const file = bootstrapFiles.find(f => f.name === name);
  return !!file && !file.missing && !!file.content;
}
