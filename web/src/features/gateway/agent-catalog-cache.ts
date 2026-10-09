const AGENT_CATALOG_CACHE_KEYS = new Set([
  'automation-chat-agents',
  'channel-routing-agents',
  'gateway-chat-agents',
  'picker-agents-list',
  'settings-gateway-agents',
  'setup-checklist-agents',
  'workflow-agents',
  'workflow-route-agents',
]);

export function isAgentCatalogCacheKey(key: unknown): boolean {
  const root = Array.isArray(key) ? key[0] : key;
  return typeof root === 'string' && AGENT_CATALOG_CACHE_KEYS.has(root);
}
