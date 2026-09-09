import type { MemoryCitationsMode } from '../types.js';

export function buildMemorySection(params: {
  availableTools: Set<string>;
  citationsMode?: MemoryCitationsMode;
  hasProfileMemory?: boolean;
  includeMemorySection?: boolean;
}): string {
  if (params.includeMemorySection === false) return '';
  const names = params.availableTools;
  const hasRecall = ['user_context_search', 'user_context_get', 'knowledge_search', 'knowledge_get',
    'session_recall', 'session_search'].some((name) => names.has(name));
  if (!hasRecall && !params.hasProfileMemory) return '';

  const lines = [
    '## Context and memory',
    '',
    'Confirmed user context, labeled working assumptions, goals, priorities, collaboration rules, and task knowledge are selected for each turn.',
    'When exact or additional context is needed:',
  ];
  if (names.has('user_context_search')) {
    lines.push('- Use `user_context_search` for user identity, preferences, routines, and current state.');
  }
  if (names.has('user_context_update')) {
    lines.push('- When the current user explicitly corrects, confirms, rejects, or asks to forget an existing user assertion, use `user_context_update` immediately and include an exact quote as evidence. Never use it for an inference of your own.');
  }
  if (names.has('knowledge_search')) {
    lines.push('- Use `knowledge_search` for project facts, decisions, lessons, commitments, and open questions.');
  }
  if (names.has('session_recall')) lines.push('- Use `session_recall` for exact raw content from the current session.');
  if (names.has('session_search')) lines.push('- Use `session_search` for other conversations.');
  if (names.has('knowledge_write')) {
    lines.push('- Use `knowledge_write` for reusable task knowledge; it is stored as a reviewable candidate with provenance.');
  }
  lines.push(
    '',
    'User facts are declarative. Reusable procedures belong in skills.',
    'Do not infer importance from confidence: confidence measures truth likelihood; importance measures execution value.',
  );
  return lines.join('\n');
}

export function buildExternalMemorySection(text: string | undefined): string {
  const value = text?.trim();
  return value ? `## External knowledge provider\n\n${value}` : '';
}

export function buildSkillsSection(hasSkillTools: boolean): string {
  if (!hasSkillTools) return '';
  return [
    '## Skills (mandatory)',
    'Before replying: scan <available_skills> <description> entries.',
    '- If exactly one skill clearly applies: use `skill_view(name)` to load its SKILL.md, then follow it.',
    '- If multiple could apply: choose the most specific one, then load/follow it.',
    '- If none clearly apply: do not load any SKILL.md.',
    'Constraints: never load more than one skill up front; only load after selecting.',
    '- When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After.',
    '',
    '**Division of labor:** Skills contain procedures; user context and knowledge contain declarative facts.',
  ].join('\n');
}
