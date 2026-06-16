import type { MemoryCitationsMode } from '../types.js';

export function buildMemorySection(params: {
  availableTools: Set<string>;
  citationsMode?: MemoryCitationsMode;
  hasProfileMemory?: boolean;
  includeMemorySection?: boolean;
}): string {
  if (params.includeMemorySection === false) {
    return '';
  }
  const hasMemoryTools =
    params.availableTools.has('memory_search') ||
    params.availableTools.has('memory_get') ||
    params.availableTools.has('curated_memory');
  if (!hasMemoryTools && !params.hasProfileMemory) {
    return '';
  }

  const citationsMode = params.citationsMode ?? 'on';
  const citationInstruction =
    citationsMode === 'off'
      ? 'Citations are disabled: do not mention file paths or line numbers in replies.'
      : citationsMode === 'source-only'
        ? 'Citations: mention file path when it helps (e.g., Source: MEMORY.md).'
        : 'Citations: include Source: <path#line> when it helps the user verify memory snippets.';

  const toolLines: string[] = [];
  if (params.availableTools.has('memory_search')) {
    toolLines.push('1. Run `memory_search` on profile MEMORY.md and workspace `memory/*.md`');
  }
  if (params.availableTools.has('session_search')) {
    toolLines.push(
      `${toolLines.length + 1}. For **other chat sessions** / cross-session history, use \`session_search\` with keywords (or omit \`query\` to list recent sessions)`,
    );
  }
  if (params.availableTools.has('memory_get')) {
    toolLines.push(`${toolLines.length + 1}. Use \`memory_get\` to pull only the needed lines from files`);
  }
  if (params.availableTools.has('curated_memory')) {
    toolLines.push(
      `${toolLines.length + 1}. For structured curated notes under agent home \`memories/\`, use \`curated_memory\``,
    );
  }
  toolLines.push(`${toolLines.length + 1}. If low confidence after search, say you checked`);

  return [
    '## Memory Recall',
    '',
    citationInstruction,
    '',
    'Startup profile files (SOUL, USER, MEMORY, etc.) are already in Project Context above when injected. Do not re-read them unless the user asks or you need lines beyond what was injected.',
    '',
    'Before answering anything about prior work, decisions, dates, people, preferences, or todos:',
    ...toolLines,
    '',
    '### Memory Files',
    '',
    '- **Daily notes:** `memory/YYYY-MM-DD.md` — raw logs (runtime may preload recent days on /new or reset)',
    '- **Long-term:** profile `MEMORY.md` — curated memories in Project Context when present',
    '- **Curated store:** agent home `memories/MEMORY.md` and `memories/USER.md` — use `curated_memory` for live read/write',
    '',
    '### Writing to Memory',
    '',
    '- **Declarative vs procedural:** Save facts and preferences via workspace memory files and/or `curated_memory`. Save reusable task playbooks with `skill_manage` as skills.',
    '- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE',
    '- When someone says "remember this" → update `memory/YYYY-MM-DD.md` or relevant file',
    '- **Text > Brain**',
  ].join('\n');
}

export function buildExternalMemorySection(text: string | undefined): string {
  const t = text?.trim();
  if (!t) {
    return '';
  }
  return `## External memory provider\n\n${t}`;
}

export function buildSkillsSection(hasSkillTools: boolean): string {
  if (!hasSkillTools) {
    return '';
  }

  return [
    '## Skills (mandatory)',
    'Before replying: scan <available_skills> <description> entries.',
    '- If exactly one skill clearly applies: use `skill_view(name)` to load its SKILL.md, then follow it.',
    '- If multiple could apply: choose the most specific one, then load/follow it.',
    '- If none clearly apply: do not load any SKILL.md.',
    'Constraints: never load more than one skill up front; only load after selecting.',
    '- When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After.',
    '',
    '**Division of labor with memory:** Skills = **procedural** workflows; memory / `curated_memory` = **declarative** facts and preferences.',
  ].join('\n');
}
