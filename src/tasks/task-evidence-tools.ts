const TASK_EVIDENCE_TOOLS = new Set([
  'read_file', 'read_media', 'image', 'image_generate', 'web_fetch', 'web_search', 'web_extract',
  'exec_command', 'managed_job', 'xopc_tool_execute', 'publish_artifacts', 'session_status', 'task_collaboration',
  'session_search', 'knowledge_search', 'knowledge_get', 'knowledge_read',
]);

/** Keep evidence receipts, transcript discovery and source binding on the same tool set. */
export function isTaskEvidenceTool(name: string): boolean {
  return TASK_EVIDENCE_TOOLS.has(name);
}

export function hasTaskEvidenceContent(name: string, details?: { mode?: string; count?: number; requiresSpecialist?: boolean }): boolean {
  if (name === 'session_search') {
    return (details?.mode === 'read' || details?.mode === 'read_search') && (details.count ?? 0) > 0;
  }
  return name !== 'knowledge_read' || details?.requiresSpecialist !== true;
}
