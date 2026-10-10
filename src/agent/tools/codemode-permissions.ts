import type { AgentTool } from '@earendil-works/pi-agent-core';

const trustedRead = Symbol('xopc.codemode.trustedRead');
const READ_TOOLS = new Set([
  'read_file', 'list_dir', 'grep', 'find', 'knowledge_search', 'knowledge_get',
  'web_search', 'web_fetch', 'data_batch',
]);

/** Only mark tools assembled by the core factory, before external extensions are merged. */
export function markCodemodeCoreRead(tool: AgentTool): AgentTool {
  if (READ_TOOLS.has(tool.name)) Object.assign(tool, { [trustedRead]: true });
  return tool;
}

export function isCodemodeCoreRead(tool: AgentTool): boolean {
  return READ_TOOLS.has(tool.name) && Reflect.get(tool, trustedRead) === true;
}
