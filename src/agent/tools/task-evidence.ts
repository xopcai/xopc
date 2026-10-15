import type { AgentTool } from '@earendil-works/pi-agent-core';
import { suggestedEvidenceRanges } from '../../tasks/task-evidence-ranges.js';

/** Tool-call IDs are protocol metadata and may be invisible to the model; expose the host ID in Task reads. */
export function withTaskEvidenceIdentity<T extends AgentTool>(tool: T): T {
  const names = new Set(['read_file', 'read_media', 'web_fetch', 'web_search', 'web_extract', 'exec_command', 'managed_job',
    'xopc_tool_execute', 'publish_artifacts', 'session_status', 'task_collaboration']);
  if (!names.has(tool.name)) return tool;
  return { ...tool, execute: async (...args: Parameters<T['execute']>) => {
    const result = await tool.execute(args[0], args[1], args[2], args[3]);
    const artifacts = tool.name === 'publish_artifacts' ? (result.details as { artifacts?: Array<{ artifactId: string; title: string; availability: string }> })?.artifacts : undefined;
    const receipt = artifacts ? [{ type: 'text' as const, text: JSON.stringify({ publishedArtifacts: artifacts.map(({ artifactId, title, availability }) => ({ artifactId, title, availability })),
      guidance: 'Use exact artifactId values in publish_task_result.finalArtifactIds to select final deliverables.' }) }] : [];
    const execution = result.details as { status?: string; exitCode?: number | null } | undefined;
    const body = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    const ranges = !(result as { isError?: boolean }).isError && !['failed', 'blocked', 'running', 'timed_out', 'cancelled'].includes(execution?.status ?? '')
      && (tool.name !== 'managed_job' || execution?.status === 'success' && execution.exitCode === 0)
      ? [{ type: 'text' as const, text: JSON.stringify({ evidence: { toolCallId: args[0], excerptRanges: suggestedEvidenceRanges(body),
        guidance: 'Prefer toolCallId plus excerptRange in publish_task_result.sources; omit excerpt. The host copies exact observed output. For a yielded command cite the successful managed_job completion ID, not the earlier running exec_command. Never rerun completed work merely to obtain evidence. Never reconstruct quoted code, escapes or input commands. This identifies provenance; claim support still requires review.' } }) }] : [];
    const quote = tool.name === 'exec_command' && execution?.status === 'success' && execution.exitCode === 0
      ? [{ type: 'text' as const, text: 'Evidence quoting: copy a short contiguous passage from the output above. The input command is not output; never prepend it to an excerpt. Successful execution and exitCode=0 are host metadata, not extra lines to invent in a quote.' }] : [];
    return { ...result, content: [...result.content, ...receipt, ...quote, ...ranges, { type: 'text' as const, text: `Task source toolCallId: ${args[0]}` }] };
  } } as T;
}
