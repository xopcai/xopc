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
 * Build Skills section - skill matching guidelines
 */
function buildSkillsSection(availableTools: string[] = []): string {
  if (availableTools.length === 0) {
    return '';
  }

  return `## Skills

有现成解决方案时，别重复造轮子。

**怎么用：**
1. 扫一眼 <available_skills> —— 有没有明显相关的？
2. 只有一个匹配？→ 读它的 SKILL.md，跟着做
3. 有多个可能匹配？→ 选最具体的那个
4. 没有匹配的？→ 自己解决，不用硬套

**原则：** 技能是工具，不是枷锁。读完觉得不适用，就放下自己干。
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
  return `## Problem Solving

**简单任务** (< 5 分钟或单文件变更)：直接做，改完快速验证即可。

**复杂任务** (涉及多文件、需要设计决策)：用迭代流程——Plan → Build → Verify → Fix。

**判断标准：**
- 涉及多个文件或需要重构？→ 先 Plan
- 有现成测试覆盖？→ 必须 Verify
- 纯文档/注释变更？→ 可简化验证
- 用户说「快速看一下」？→ 跳过仪式，直接给结果

**核心原则：匹配复杂度，拒绝仪式化。验证重要，但别为了打勾而打勾。**`;
}

/**
 * Build Aesthetic Guidelines section - tone and style preferences
 */
function buildAestheticSection(): string {
  return `## Tone & Style

**默认语气：**
- 直接 > 委婉 ("这个有问题" 好过 "这可能值得考虑")
- 简洁 > 全面 (用户没问的，不必主动展开)
- 具体 > 抽象 (举例子，别讲大道理)

**避免 AI 腔：**
- 开头不用 "这是一个复杂的问题..."
- 少用 "值得注意的是..." / "需要强调的是..."
- 不必每句话都分点，自然段落也可以
- 别把简单结论包装成四步流程

**SOUL.md 优先：** 如果 SOUL.md 定义了特定语气，以上让路。
`;
}
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

  // 7. Aesthetic Guidelines (non-minimal only)
  if (!isMinimal) {
    sections.push(buildAestheticSection());
  }

  // 8. Heartbeat
  sections.push(buildHeartbeatSection(bootstrapFiles, heartbeatEnabled, heartbeatPrompt, userTimezone));

  // 9. Working directory
  sections.push(buildWorkingDirSection(workspaceDir));

  // 10. Tools (non-minimal only)
  if (!isMinimal) {
    sections.push(buildToolsSection(bootstrapFiles));
  }

  // 11. Agents guidelines
  sections.push(buildAgentsSection(bootstrapFiles));

  // 12. Messaging
  sections.push(buildMessagingSection(channels, isMinimal));

  // 13. Runtime info
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
