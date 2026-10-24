import type { AgentTool } from '@earendil-works/pi-agent-core';

import { getXopcToolMetadata, setXopcToolMetadata } from '../embedded/tool-metadata.js';

// Keep the file edit and verification loop available without a discovery round trip.
const EAGER_CORE_TOOLS = new Set([
  'read_file', 'write_file', 'apply_patch', 'grep', 'find', 'list_dir', 'exec_command',
  'review_workspace',
  // Instruction readers bootstrap task-specific discovery without loading every tool schema.
  'skill_view', 'skills_list', 'tool_manual',
  'publish_artifacts', 'task_collaboration', 'publish_task_result',
]);

/** Defer declarations, not permissions. pi tool_search loads the unchanged contract on demand. */
export function withCoreToolExposure(tool: AgentTool): AgentTool {
  if (EAGER_CORE_TOOLS.has(tool.name) || getXopcToolMetadata(tool)?.exposure !== undefined) return tool;
  return setXopcToolMetadata(tool, { ...getXopcToolMetadata(tool), exposure: 'deferred' });
}
