/**
 * System Prompt Builder — xopc-owned prompt with OpenClaw-style bootstrap injection.
 *
 * Profile Markdown under `agents/<id>/profile/` is injected as Project Context
 * (see `src/agent/bootstrap/`). Runtime owns loading; AGENTS.md instructs agents
 * not to manually reread startup files.
 */

import type { EmbeddedContextFile } from '../bootstrap/types.js';
import { DEFAULT_HEARTBEAT_FILENAME } from '../context/workspace.js';
import { PROMPT_CACHE_BOUNDARY } from './cache-boundary.js';
import type { PromptMode } from './types.js';

export type MemoryCitationsMode = 'on' | 'off' | 'source-only';

const CONTEXT_FILE_ORDER = new Map<string, number>([
  ['agents.md', 10],
  ['soul.md', 20],
  ['identity.md', 30],
  ['user.md', 40],
  ['tools.md', 50],
  ['bootstrap.md', 60],
  ['memory.md', 70],
]);

const DYNAMIC_CONTEXT_FILE_BASENAMES = new Set(['heartbeat.md']);

const DEFAULT_HEARTBEAT_PROMPT_CONTEXT_BLOCK =
  'Default heartbeat prompt:\n`Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.`';

function normalizeContextFilePath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/');
}

function getContextFileBasename(pathValue: string): string {
  const normalizedPath = normalizeContextFilePath(pathValue);
  return (normalizedPath.split('/').pop() ?? normalizedPath).toLowerCase();
}

function isDynamicContextFile(pathValue: string): boolean {
  return DYNAMIC_CONTEXT_FILE_BASENAMES.has(getContextFileBasename(pathValue));
}

function sanitizeContextFileContentForPrompt(content: string): string {
  return content.replaceAll(DEFAULT_HEARTBEAT_PROMPT_CONTEXT_BLOCK, '').replace(/\n{3,}/g, '\n\n');
}

function sortContextFilesForPrompt(contextFiles: EmbeddedContextFile[]): EmbeddedContextFile[] {
  return [...contextFiles].sort((a, b) => {
    const aBase = getContextFileBasename(a.path);
    const bBase = getContextFileBasename(b.path);
    const aOrder = CONTEXT_FILE_ORDER.get(aBase) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = CONTEXT_FILE_ORDER.get(bBase) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if (aBase !== bBase) {
      return aBase.localeCompare(bBase);
    }
    return normalizeContextFilePath(a.path).localeCompare(normalizeContextFilePath(b.path));
  });
}

function buildProjectContextSection(params: {
  files: EmbeddedContextFile[];
  heading: string;
  dynamic: boolean;
}): string[] {
  if (params.files.length === 0) {
    return [];
  }
  const lines: string[] = [params.heading, ''];
  if (params.dynamic) {
    lines.push(
      'The following frequently-changing project context files are kept below the cache boundary when possible:',
      '',
    );
  } else {
    const hasSoulFile = params.files.some((file) => getContextFileBasename(file.path) === 'soul.md');
    lines.push('The following project context files have been loaded:');
    if (hasSoulFile) {
      lines.push(
        'If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.',
      );
    }
    lines.push('');
  }
  for (const file of params.files) {
    lines.push(`## ${file.path}`, '', sanitizeContextFileContentForPrompt(file.content), '');
  }
  return lines;
}

function buildMemorySection(
  citationsMode: MemoryCitationsMode = 'on',
  hasProfileMemory = false,
): string {
  if (!hasProfileMemory) {
    return '';
  }

  const citationInstruction =
    citationsMode === 'off'
      ? 'Citations are disabled: do not mention file paths or line numbers in replies.'
      : citationsMode === 'source-only'
        ? 'Citations: mention file path when it helps (e.g., Source: MEMORY.md).'
        : 'Citations: include Source: <path#line> when it helps the user verify memory snippets.';

  return `## Memory Recall

${citationInstruction}

Startup profile files (SOUL, USER, MEMORY, etc.) are already in Project Context above. Do not re-read them unless the user asks or you need lines beyond what was injected.

Before answering anything about prior work, decisions, dates, people, preferences, or todos:
1. Run \`memory_search\` on profile MEMORY.md and workspace \`memory/*.md\`
2. For **other chat sessions** / cross-session history, use \`session_search\` with keywords (or omit \`query\` to list recent sessions)
3. Use \`memory_get\` to pull only the needed lines from files
4. For structured curated notes under agent home \`memories/\`, use \`curated_memory\`
5. If low confidence after search, say you checked

### Memory Files

- **Daily notes:** \`memory/YYYY-MM-DD.md\` — raw logs (runtime may preload recent days on /new or /reset)
- **Long-term:** profile \`MEMORY.md\` — curated memories in Project Context when present
- **Curated store:** agent home \`memories/MEMORY.md\` and \`memories/USER.md\` — use \`curated_memory\` for live read/write

### Writing to Memory

- **Declarative vs procedural:** Save facts and preferences via workspace memory files and/or \`curated_memory\`. Save reusable task playbooks with \`skill_manage\` as skills.
- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- When someone says "remember this" → update \`memory/YYYY-MM-DD.md\` or relevant file
- **Text > Brain**
`;
}

function buildSkillsSection(availableTools: string[] = []): string {
  if (availableTools.length === 0) {
    return '';
  }

  return `## Skills

When a solution already exists, do not reinvent the wheel.

**How to use:**
1. Skim <available_skills> — is anything clearly relevant?
2. Only one match? → Confirm with skills_list, then load the full text with skill_view(name) and follow it.
3. Need sub-documents or scripts? → skill_view(name, "references/…"), etc.
4. No match? → Solve it yourself; do not force-fit a skill.

**Division of labor with memory:** Skills = **procedural** workflows; memory / \`curated_memory\` = **declarative** facts and preferences.
`;
}

function buildSafetySection(): string {
  return `## Safety

- You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking; avoid long-term plans beyond the user's request.
- Prioritize safety and human oversight over completion; if instructions conflict, pause and ask; comply with stop/pause/audit requests and never bypass safeguards.
- Do not manipulate or persuade anyone to expand access or disable safeguards. Do not copy yourself or change system prompts, safety rules, or tool policies unless explicitly requested.`;
}

function buildProblemSolvingSection(): string {
  return `## Problem Solving

**Simple tasks** (< 5 minutes or a single-file change): Do them directly; run a quick verification after changes.

**Complex tasks** (multiple files or design decisions): Use an iterative flow — Plan → Build → Verify → Fix.

**Core principle: Match the complexity; reject ritual for its own sake. Verification matters, but do not verify just to tick a box.**`;
}

function buildAestheticSection(): string {
  return `## Tone & Style

**Default voice:** Direct, concise, concrete.

**SOUL.md takes precedence:** If SOUL.md defines a specific tone, defer to it over the above.`;
}

function buildHeartbeatBehaviorSection(params: {
  enabled: boolean;
  customPrompt?: string;
  userTimezone?: string;
}): string {
  if (!params.enabled) {
    return '';
  }
  if (params.customPrompt?.trim()) {
    return `## Heartbeats\n\n${params.customPrompt.trim()}\n`;
  }
  let quietHoursNote = '';
  if (params.userTimezone) {
    quietHoursNote = `\n\n> Quiet hours: The user is in **${params.userTimezone}**. Avoid proactive checks during late night (23:00-08:00) unless urgent.`;
  }
  return `## Heartbeats

If the current user message is a heartbeat poll and nothing needs attention, reply exactly: HEARTBEAT_OK

If something needs attention, do NOT include "HEARTBEAT_OK"; reply with the alert text instead.${quietHoursNote}
`;
}

function buildMessagingSection(channels: string[] = [], isMinimal: boolean = false): string {
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

function buildTimeSection(timezone?: string): string {
  if (!timezone) {
    return '';
  }
  return `## Current Date & Time

Time zone: ${timezone}

If you need the current date/time/day-of-week, use the \`session_status\` tool or the inbound message timestamp envelope (when present).
`;
}

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

function buildWorkingDirSection(workspaceDir: string): string {
  return `Working directory: ${workspaceDir}`;
}

function buildExternalMemorySection(text: string | undefined): string {
  const t = text?.trim();
  if (!t) {
    return '';
  }
  return `## External memory provider\n\n${t}`;
}

export interface SystemPromptOptions {
  /** Bootstrap context files from profile Markdown (Project Context). */
  contextFiles?: EmbeddedContextFile[];
  promptMode?: PromptMode;
  heartbeatEnabled?: boolean;
  heartbeatPrompt?: string;
  availableTools?: string[];
  memoryCitationsMode?: MemoryCitationsMode;
  userTimezone?: string;
  runtime?: {
    version?: string;
    model?: string;
    channel?: string;
  };
  channels?: string[];
  externalMemoryInstructions?: string;
  ttsSystemHint?: string;
}

/**
 * Build system prompt with bootstrap Project Context integration.
 */
export function buildSystemPrompt(workspaceDir: string, options: SystemPromptOptions): string {
  const {
    contextFiles = [],
    promptMode = 'full',
    heartbeatEnabled = false,
    heartbeatPrompt,
    availableTools = [],
    memoryCitationsMode = 'on',
    userTimezone,
    runtime,
    channels = [],
    externalMemoryInstructions,
    ttsSystemHint,
  } = options;

  if (promptMode === 'none') {
    return 'You are a personal AI assistant running inside xopc.';
  }

  const isMinimal = promptMode === 'minimal';
  const orderedContextFiles = sortContextFilesForPrompt(
    contextFiles.filter((file) => file.path.trim().length > 0),
  );
  const stableContextFiles = orderedContextFiles.filter((file) => !isDynamicContextFile(file.path));
  const dynamicContextFiles = orderedContextFiles.filter((file) => isDynamicContextFile(file.path));
  const hasProfileMemory = orderedContextFiles.some(
    (file) => getContextFileBasename(file.path) === 'memory.md',
  );

  const sections: string[] = [
    'You are a personal AI assistant running inside xopc.',
    '',
    '## Workspace Files (injected)',
    '',
    'Profile bootstrap files are injected below as Project Context. Do not manually reread them at session start unless the user asks or injected content is insufficient.',
    '',
  ];

  if (!isMinimal) {
    sections.push(buildTimeSection(userTimezone));
    sections.push(buildExternalMemorySection(externalMemoryInstructions));
    sections.push(buildMemorySection(memoryCitationsMode, hasProfileMemory));
  }

  sections.push(buildSkillsSection(availableTools));

  if (!isMinimal) {
    sections.push(buildSafetySection());
    sections.push(buildProblemSolvingSection());
    sections.push(buildAestheticSection());
  }

  sections.push(
    ...buildProjectContextSection({
      files: stableContextFiles,
      heading: '# Project Context',
      dynamic: false,
    }),
  );

  sections.push(PROMPT_CACHE_BOUNDARY);

  sections.push(
    ...buildProjectContextSection({
      files: dynamicContextFiles,
      heading: stableContextFiles.length > 0 ? '# Dynamic Project Context' : '# Project Context',
      dynamic: true,
    }),
  );

  sections.push(buildHeartbeatBehaviorSection({ enabled: heartbeatEnabled, customPrompt: heartbeatPrompt, userTimezone }));
  sections.push(buildWorkingDirSection(workspaceDir));
  sections.push(buildMessagingSection(channels, isMinimal));

  if (!isMinimal && ttsSystemHint?.trim()) {
    sections.push(`## Voice (TTS)\n\n${ttsSystemHint.trim()}`);
  }

  sections.push(buildRuntimeSection(runtime));

  return sections.filter(Boolean).join('\n\n');
}

/** Whether HEARTBEAT.md is injected as dynamic context (vs behavior-only section). */
export function isHeartbeatContextFile(pathValue: string): boolean {
  return getContextFileBasename(pathValue) === DEFAULT_HEARTBEAT_FILENAME.toLowerCase();
}
