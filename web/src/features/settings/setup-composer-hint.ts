/** Composer seed suffix when opening chat from Settings "Configure with AI". */
export const SETUP_DOMAIN_COMPOSER_HINT: Record<string, string> = {
  providers: 'Help me configure LLM provider API keys.',
  channels: 'Help me connect a messaging channel (e.g. Telegram).',
  voice: 'Help me configure text-to-speech / voice output.',
  search: 'Help me set up web search providers.',
  mcp: 'Help me configure MCP servers for the agent.',
  heartbeat: 'Help me configure gateway heartbeat polling.',
  agents: 'Help me set the default chat model.',
};

export function composeSkillWireSeed(skillId: string, domain?: string | null): string {
  const hint = domain?.trim() ? SETUP_DOMAIN_COMPOSER_HINT[domain.trim()] : undefined;
  if (hint) {
    return `/skill:${skillId} ${hint}`;
  }
  return `/skill:${skillId} `;
}
