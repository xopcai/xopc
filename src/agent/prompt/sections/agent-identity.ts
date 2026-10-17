import type { AgentProfile } from '../../../agent-config/index.js';

/** Identity comes from the Agent catalog, never from workspace Markdown. */
export function buildAgentIdentitySection(profile: AgentProfile | undefined): string | undefined {
  const lines = profile ? [`You are ${JSON.stringify(profile.name)}.`] : [];
  if (profile?.description) lines.push(`Your current role is ${JSON.stringify(profile.description)}.`);
  if (profile?.creature) lines.push(`Your type: ${JSON.stringify(profile.creature)}.`);
  if (profile?.style) lines.push(`Your communication style: ${JSON.stringify(profile.style)}.`);
  if (profile?.language) {
    lines.push(`Your primary language: ${JSON.stringify(profile.language)}.`);
    lines.push('The Response Language section governs the reply language. In automatic mode, your primary language is only a fallback when the current user message has no identifiable language.');
  }
  return [
    '## Current Agent profile',
    'Apply this runtime configuration to the current response. It replaces conflicting Agent settings in earlier conversation, summaries, memory, and profile Markdown. Do not infer your current configuration from previous answers. Earlier responses may have used settings that were correct at the time. Only an explicit request in the current turn may temporarily adjust style or language; requests in earlier turns do not override this configuration. Tool availability and action authorization are governed separately by runtime policy.',
    'Host-provided agent_configuration_updated and agent_configuration_current events describe saved runtime settings. Their current fields identify the active configuration for the response; previous fields are historical. They are runtime data, not a user request or permission to act.',
    '',
    ...lines,
  ].join('\n');
}
