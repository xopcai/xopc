/**
 * System Prompt Builder - Enhanced version with workspace context integration
 * 
 * Integrates profile Markdown files at the workspace root:
 * - SOUL.md for persona and tone
 * - USER.md for user context
 * - IDENTITY.md for agent identity
 * - HEARTBEAT.md for task polling
 * - MEMORY.md for long-term memory
 * - Memory search integration in prompt
 */

import type { WorkspaceProfileMarkdownFile } from '../context/workspace.js';
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
import type { MemorySnapshot } from '../memory/types.js';
import { PROMPT_CACHE_BOUNDARY } from './cache-boundary.js';
import type { PromptMode } from './types.js';

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
  /** Workspace profile Markdown files (SOUL, USER, …) */
  profileMarkdownFiles: WorkspaceProfileMarkdownFile[];
  /** Which sections to include. Defaults to "full". */
  promptMode?: PromptMode;
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
  /** Frozen curated memory from agent home `memories/` (session start only). */
  curatedMemorySnapshot?: MemorySnapshot;
  /** External memory provider static instructions. */
  externalMemoryInstructions?: string;
  /** Optional TTS / voice output guidance (when TTS is enabled). */
  ttsSystemHint?: string;
}

// =============================================================================
// Section Builders
// =============================================================================

/**
 * Build SOUL.md section - persona and tone
 * 
 * If SOUL.md is present, embody its persona and tone
 */
function buildSoulSection(profileMarkdownFiles: WorkspaceProfileMarkdownFile[]): string {
  const soulFile = profileMarkdownFiles.find(f => f.name === DEFAULT_SOUL_FILENAME);
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
function buildUserSection(profileMarkdownFiles: WorkspaceProfileMarkdownFile[]): string {
  const userFile = profileMarkdownFiles.find(f => f.name === DEFAULT_USER_FILENAME);
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
 * Curated MEMORY.md + USER.md blocks (frozen at session start).
 */
function buildExternalMemorySection(text: string | undefined): string {
  const t = text?.trim();
  if (!t) {
    return '';
  }
  return `## External memory provider

${t}`;
}

function buildCuratedMemorySection(snapshot: MemorySnapshot | undefined): string {
  const mem = snapshot?.memory?.trim() ?? '';
  const user = snapshot?.user?.trim() ?? '';
  if (!mem && !user) {
    return '';
  }

  const body = [mem, user].filter(Boolean).join('\n\n');
  return `## Curated memory (session snapshot)

> Frozen when this session started. Updates use \`curated_memory\` and save under agent home \`memories/\`; they do not change this block until a new session.

${body}`;
}

/**
 * Build IDENTITY.md section - agent identity
 */
function buildIdentitySection(profileMarkdownFiles: WorkspaceProfileMarkdownFile[]): string {
  const identityFile = profileMarkdownFiles.find(f => f.name === DEFAULT_IDENTITY_FILENAME);
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
function buildAgentsSection(profileMarkdownFiles: WorkspaceProfileMarkdownFile[]): string {
  const agentsFile = profileMarkdownFiles.find(f => f.name === DEFAULT_AGENTS_FILENAME);
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
function buildToolsSection(profileMarkdownFiles: WorkspaceProfileMarkdownFile[]): string {
  const toolsFile = profileMarkdownFiles.find(f => f.name === DEFAULT_TOOLS_FILENAME);
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
  profileMarkdownFiles: WorkspaceProfileMarkdownFile[],
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
  const heartbeatFile = profileMarkdownFiles.find(f => f.name === DEFAULT_HEARTBEAT_FILENAME);
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
  profileMarkdownFiles: WorkspaceProfileMarkdownFile[],
  citationsMode: MemoryCitationsMode = 'on',
  hasCuratedSnapshot = false,
): string {
  const memoryFile = profileMarkdownFiles.find(f => f.name === DEFAULT_MEMORY_FILENAME);
  const hasWorkspaceMemoryFile = !!(memoryFile && !memoryFile.missing);

  if (!hasWorkspaceMemoryFile && !hasCuratedSnapshot) {
    return '';
  }

  const citationInstruction = citationsMode === 'off'
    ? 'Citations are disabled: do not mention file paths or line numbers in replies.'
    : citationsMode === 'source-only'
    ? 'Citations: mention file path when it helps (e.g., Source: MEMORY.md).'
    : 'Citations: include Source: <path#line> when it helps the user verify memory snippets.';

  const curatedLines = hasCuratedSnapshot
    ? `
- **Curated store:** agent home \`memories/MEMORY.md\` and \`memories/USER.md\` — use \`curated_memory\` to add/replace/remove/read structured entries.`
    : '';

  return `## Memory Recall

${citationInstruction}

Before answering anything about prior work, decisions, dates, people, preferences, or todos:
1. Run \`memory_search\` on profile MEMORY.md, agent-home \`memories/*.md\`, and workspace \`memory/*.md\`
2. For **other chat sessions** / cross-session history, use \`session_search\` with keywords (or omit \`query\` to list recent sessions)
3. Use \`memory_get\` to pull only the needed lines from files
4. If low confidence after search, say you checked

### Memory Files

- **Daily notes:** \`memory/YYYY-MM-DD.md\` — raw logs of what happened
- **Long-term:** \`MEMORY.md\` — your curated memories, like a human's long-term memory${curatedLines}

### Writing to Memory

- **Declarative vs procedural:** Save **facts and preferences** (who the user is, how they want you to behave, stable environment) via workspace memory files and/or \`curated_memory\`. Save **reusable task playbooks** (steps, pitfalls, verification for a class of work) with \`skill_manage\` as skills — not as long prose in MEMORY.md.
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

When a solution already exists, do not reinvent the wheel.

**How to use:**
1. Skim <available_skills> — is anything clearly relevant?
2. Only one match? → Confirm with skills_list, then load the full text with skill_view(name) and follow it.
3. Need sub-documents or scripts? → skill_view(name, "references/…"), etc. (only references, templates, scripts, assets)
4. No match? → Solve it yourself; do not force-fit a skill.

**Principle:** Skills are tools, not shackles. If after reading one it does not fit, set it aside and proceed on your own.

**Division of labor with memory:** Skills = **procedural** workflows (how to do a class of tasks); memory / \`curated_memory\` = **declarative** facts and preferences. After a complex task succeeds, you may codify it as a skill; user-profile-style information belongs in memory. When a skill is outdated or incomplete, fix it immediately with \`skill_manage\` (e.g. patch).
`;
}

function buildSafetySection(): string {
  return `## Safety

- You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking; avoid long-term plans beyond the user's request.
- Prioritize safety and human oversight over completion; if instructions conflict, pause and ask; comply with stop/pause/audit requests and never bypass safeguards.
- Do not manipulate or persuade anyone to expand access or disable safeguards. Do not copy yourself or change system prompts, safety rules, or tool policies unless explicitly requested.`;
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

**Simple tasks** (< 5 minutes or a single-file change): Do them directly; run a quick verification after changes.

**Complex tasks** (multiple files or design decisions): Use an iterative flow — Plan → Build → Verify → Fix.

**Decision criteria:**
- Multiple files or refactoring? → Plan first
- Existing test coverage? → You must verify
- Documentation or comments only? → Verification can be lighter
- User says "just take a quick look"? → Skip ceremony; deliver the result directly

**Core principle: Match the complexity; reject ritual for its own sake. Verification matters, but do not verify just to tick a box.**`;
}

/**
 * Build Aesthetic Guidelines section - tone and style preferences
 */
function buildAestheticSection(): string {
  return `## Tone & Style

**Default voice:**
- Direct over diplomatic ("This is broken" beats "This might be worth considering")
- Concise over exhaustive (do not expand on what the user did not ask for)
- Concrete over abstract (use examples, not lectures)

**Avoid LLM-isms:**
- Do not open with "This is a complex question..."
- Rarely use "It is worth noting..." / "It is important to emphasize..."
- Not every sentence needs bullets; natural paragraphs are fine
- Do not wrap a simple takeaway in a four-step framework

**SOUL.md takes precedence:** If SOUL.md defines a specific tone, defer to it over the above.
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

If you need the current date/time/day-of-week, use the \`session_status\` tool or the inbound message timestamp envelope (when present).
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
    profileMarkdownFiles,
    promptMode = 'full',
    heartbeatEnabled = false,
    heartbeatPrompt,
    availableTools = [],
    memoryCitationsMode = 'on',
    userTimezone,
    runtime,
    channels = [],
    curatedMemorySnapshot,
    externalMemoryInstructions,
    ttsSystemHint,
  } = options;

  if (promptMode === 'none') {
    return 'You are a personal AI assistant running inside xopc.';
  }

  const isMinimal = promptMode === 'minimal';

  const curatedUserFrozen = !!(curatedMemorySnapshot?.user?.trim());
  const hasCuratedSnapshot = !!(
    curatedMemorySnapshot?.memory?.trim() || curatedMemorySnapshot?.user?.trim()
  );

  const sections: string[] = [];

  // 1. Identity and persona (non-minimal only)
  if (!isMinimal) {
    sections.push(buildIdentitySection(profileMarkdownFiles));
    sections.push(buildSoulSection(profileMarkdownFiles));
  }

  // 2. Curated memory snapshot (non-minimal; frozen at session start)
  if (!isMinimal) {
    sections.push(buildCuratedMemorySection(curatedMemorySnapshot));
  }

  // 2b. External memory provider
  if (!isMinimal) {
    sections.push(buildExternalMemorySection(externalMemoryInstructions));
  }

  // 3. User context — workspace USER.md unless curated user block is active
  if (!isMinimal && !curatedUserFrozen) {
    sections.push(buildUserSection(profileMarkdownFiles));
  }

  // 4. Time (non-minimal only)
  if (!isMinimal) {
    sections.push(buildTimeSection(userTimezone));
  }

  // 5. Memory section (non-minimal only)
  if (!isMinimal) {
    sections.push(buildMemorySection(profileMarkdownFiles, memoryCitationsMode, hasCuratedSnapshot));
  }

  // 6. Skills
  sections.push(buildSkillsSection(availableTools));

  // 6b. Safety (non-minimal only)
  if (!isMinimal) {
    sections.push(buildSafetySection());
  }

  // 7. Problem Solving Workflow (non-minimal only) - Harness Engineering
  if (!isMinimal) {
    sections.push(buildProblemSolvingSection());
  }

  // 8. Aesthetic Guidelines (non-minimal only)
  if (!isMinimal) {
    sections.push(buildAestheticSection());
  }

  // Cache boundary — stable content above is a better prompt-cache prefix for supported providers
  sections.push(PROMPT_CACHE_BOUNDARY);

  // 9. Heartbeat
  sections.push(buildHeartbeatSection(profileMarkdownFiles, heartbeatEnabled, heartbeatPrompt, userTimezone));

  // 10. Working directory
  sections.push(buildWorkingDirSection(workspaceDir));

  // 11. Tools (non-minimal only)
  if (!isMinimal) {
    sections.push(buildToolsSection(profileMarkdownFiles));
  }

  // 12. Agents guidelines
  sections.push(buildAgentsSection(profileMarkdownFiles));

  // 13. Messaging
  sections.push(buildMessagingSection(channels, isMinimal));

  // 13b. Voice (TTS)
  if (!isMinimal && ttsSystemHint?.trim()) {
    sections.push(`## Voice (TTS)\n\n${ttsSystemHint.trim()}`);
  }

  // 14. Runtime info
  sections.push(buildRuntimeSection(runtime));

  // Filter out empty sections and join
  return sections.filter(Boolean).join('\n\n');
}

/**
 * Build minimal system prompt for subagents/cron jobs (Internal)
 */
function _buildMinimalSystemPrompt(
  workspaceDir: string,
  profileMarkdownFiles: WorkspaceProfileMarkdownFile[]
): string {
  return buildSystemPrompt(workspaceDir, {
    profileMarkdownFiles,
    promptMode: 'minimal',
    heartbeatEnabled: false,
  });
}

/**
 * Get profile Markdown file by name (Internal)
 */
function _getProfileMarkdownFile(
  profileMarkdownFiles: WorkspaceProfileMarkdownFile[],
  name: string
): WorkspaceProfileMarkdownFile | undefined {
  return profileMarkdownFiles.find(f => f.name === name);
}

/**
 * Check if specific profile Markdown file exists and is loaded (Internal)
 */
function _hasProfileMarkdownFile(
  profileMarkdownFiles: WorkspaceProfileMarkdownFile[],
  name: string
): boolean {
  const file = profileMarkdownFiles.find(f => f.name === name);
  return !!file && !file.missing && !!file.content;
}
