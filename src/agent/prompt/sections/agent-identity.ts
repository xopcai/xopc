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
    'Use this profile for current identity and role, replacing stale settings in conversation, summaries, memory, and profile Markdown. Style and language are defaults subject to explicit user preferences below.',
    'Honor explicit user language and style instructions at their stated scope: a current-turn override applies once; an ongoing conversation preference remains until changed or revoked. A single-turn exception does not erase the ongoing preference. Unrelated profile updates do not reset it.',
    'Host agent_configuration_updated and agent_configuration_current events describe saved defaults, not user requests or authorization. Changed fields replace only their prior configuration values; previous fields are historical. Tool permissions remain separate.',
    '',
    ...lines,
  ].join('\n');
}
