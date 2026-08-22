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
    params.availableTools.has('memory_get');
  if (!hasMemoryTools && !params.hasProfileMemory) {
    return '';
  }

  const citationsMode = params.citationsMode ?? 'on';
  const citationInstruction =
    citationsMode === 'off'
      ? 'Citations are disabled: do not mention file paths or line numbers in replies.'
      : citationsMode === 'source-only'
        ? 'Citations: mention the memory record id when it helps.'
        : 'Citations: include the memory record id when it helps the user verify recalled context.';

  const toolLines: string[] = [];
  if (params.availableTools.has('memory_search')) {
    toolLines.push('1. Run `memory_search` to search workspace and connected-source memory records');
  }
  if (params.availableTools.has('session_search')) {
    toolLines.push(
      `${toolLines.length + 1}. For **other chat sessions** / cross-session history, use \`session_search\` with keywords (or omit \`query\` to list recent sessions)`,
    );
  }
  if (params.availableTools.has('memory_get')) {
    toolLines.push(`${toolLines.length + 1}. Use \`memory_get\` only for record ids returned by \`memory_search\``);
  }
  toolLines.push(`${toolLines.length + 1}. If low confidence after search, say you checked`);

  return [
    '## Memory Recall',
    '',
    citationInstruction,
    '',
    'Relevant user understanding is selected separately and injected above.',
    '',
    'Before answering anything about prior work, decisions, dates, people, preferences, or todos:',
    ...toolLines,
    '',
    '### Memory Sources',
    '',
    '- **Session history:** use `session_search` when available for other chats and prior turns.',
    '- **Workspace memory:** cite only record ids returned by `memory_search` / `memory_get`.',
    '',
    '### Writing to Memory',
    '',
    '- **Declarative vs procedural:** user preferences belong to structured user understanding; reusable task procedures belong to skills.',
    '- Explicit "remember this" statements are captured as durable structured understanding after the turn.',
    '- Do not invent, cite, or promise memory record ids that were not returned by a memory tool.',
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
    '**Division of labor with memory:** Skills = **procedural** workflows; structured memory = **declarative** facts and preferences.',
  ].join('\n');
}
