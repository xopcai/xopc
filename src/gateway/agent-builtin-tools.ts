/**
 * Built-in agent tool `name` values for gateway admin UI (disable toggles).
 * Extension tools are not listed; users can still add arbitrary strings in config.
 */
export const GATEWAY_BUILTIN_TOOL_IDS = [
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'grep',
  'find',
  'shell',
  'web_search',
  'web_fetch',
  'send_message',
  'send_media',
  'memory_search',
  'memory_get',
  'curated_memory',
  'session_search',
  'image',
  'image_generate',
  'extensions',
  'bundle-mcp',
] as const;

export type GatewayBuiltinToolId = (typeof GATEWAY_BUILTIN_TOOL_IDS)[number];
