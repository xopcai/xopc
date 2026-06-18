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
  'session_status',
  'dreaming',
  'tool_manual',
  'clarify',
  'todo',
  'skills_list',
  'skill_view',
  'skill_manage',
  'web_search',
  'web_fetch',
  'web_extract',
  'send_message',
  'send_media',
  'read_media',
  'create_share',
  'text_to_speech',
  'memory_search',
  'memory_get',
  'curated_memory',
  'session_search',
  'cronjob',
  'workflow',
  'delegate_task',
  'execute_code',
  'image',
  'image_generate',
  'browser_use',
  'extensions',
  'bundle-mcp',
] as const;

export type GatewayBuiltinToolId = (typeof GATEWAY_BUILTIN_TOOL_IDS)[number];
