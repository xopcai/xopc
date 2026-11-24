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
    'session_recall', 'session_search', 'user_context_read', 'knowledge_read'].some((name) => names.has(name));
  if (!hasRecall && !params.hasProfileMemory) return '';

  const lines = [
    '## Context and memory',
    'Before relying on prior decisions, commitments, dates, people, or preferences, check the evidence in context or retrieve missing detail with memory/history tools—never reconstruct past events by guessing.',
    'Distinguish explicit user statements from working assumptions; current user corrections win. State uncertainty if evidence is missing, and never claim a memory was saved, corrected, or forgotten without a successful tool result.',
  ];
  if (names.has('user_context_read')) lines.push('- `user_context_read`: user facts and preferences.');
  if (names.has('knowledge_read')) lines.push('- `knowledge_read`: scoped project decisions and knowledge.');
  if (names.has('user_context_search')) {
    lines.push('- `user_context_search`: user identity, preferences, routines, and current state.');
  }
  if (names.has('user_context_update')) {
    lines.push('- `user_context_update`: use immediately when the user explicitly corrects, confirms, rejects, or forgets an assertion (quote exact evidence; never for your own inference).');
  }
  if (names.has('knowledge_search')) {
    lines.push('- `knowledge_search`: project facts, decisions, lessons, commitments, and open questions.');
  }
  if (names.has('session_recall')) lines.push('- `session_recall` for exact raw content from the current session.');
  if (names.has('session_search')) lines.push('- `session_search` for other conversations across agents and projects (`since`/`until`/`agentId`/`projectId`, keyword, or `conversationId`).');
  if (names.has('knowledge_write')) {
    lines.push('- `knowledge_write`: reusable task knowledge (stored as a reviewable candidate with provenance).');
  }
  lines.push('User facts are declarative; reusable procedures belong in skills. Confidence = truth likelihood, importance = execution value.');
  return lines.join('\n');
}

export function buildExternalMemorySection(text: string | undefined): string {
  const value = text?.trim();
  return value ? `## External knowledge provider\n\n${value}` : '';
}

export function buildSkillsSection(toolNames: string[]): string {
  const view = toolNames.find(name => name.trim().toLowerCase() === 'skill_view')?.trim();
  if (!view) return '';
  return [
    '## Skills (mandatory)',
    `Scan <available_skills> descriptions before replying. Load the most specific applicable skill with ${view}(name); load no skill when none applies, and at most one up front.`,
    'Follow its procedures within the authorized task. For external writes, batch requests, serialize bursts, and respect 429/Retry-After.',
  ].join('\n');
}
