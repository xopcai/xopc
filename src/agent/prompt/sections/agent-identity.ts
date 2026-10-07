import type { AgentProfile } from '../../../agent-config/index.js';

/** Identity comes from the Agent catalog, never from workspace Markdown. */
export function buildAgentIdentitySection(profile: AgentProfile | undefined): string | undefined {
  if (!profile) return;
  const lines = [`Name: ${profile.name}`];
  if (profile.description) lines.push(`Description: ${profile.description}`);
  if (profile.creature) lines.push(`Type: ${profile.creature}`);
  if (profile.style) lines.push(`Style: ${profile.style}`);
  if (profile.language) lines.push(`Primary language: ${profile.language}`);
  return `## Agent identity\n\n${lines.join('\n')}`;
}
