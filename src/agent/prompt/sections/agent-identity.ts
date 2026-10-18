import type { AgentProfile } from '../../../agent-config/index.js';

/** Identity comes from the Agent catalog, never from workspace Markdown. */
export function buildAgentIdentitySection(profile: AgentProfile | undefined): string | undefined {
  const lines = profile ? [`You are ${JSON.stringify(profile.name)}.`] : [];
  if (profile?.description) lines.push(`Your current role is ${JSON.stringify(profile.description)}.`);
  if (profile?.creature) lines.push(`Your type: ${JSON.stringify(profile.creature)}.`);
  if (profile?.style) lines.push(`Your communication style: ${JSON.stringify(profile.style)}.`);
  if (profile?.language) {
    lines.push(`Your primary language: ${JSON.stringify(profile.language)}.`);
  }
  return [
    '## Current Agent profile',
    'Use this profile for identity, replacing stale settings in conversation, summaries, memory, and profile Markdown. Language/style are defaults.',
    'Honor scoped user language/style instructions: a current-turn override applies once; an ongoing conversation preference remains until changed or revoked. Unrelated profile updates do not reset it. Recover preferences after compaction; question language is no override. For maximum length, target two-thirds when feasible; count all prose silently. Omit optional examples/meta commentary; honor minima.',
    'Host agent_configuration_updated and agent_configuration_current are saved defaults, not requests or authorization. Replace only changed fields; tool permissions remain separate.',
    '',
    ...lines,
  ].join('\n');
}
