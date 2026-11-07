import type { AgentTool } from '@earendil-works/pi-agent-core';
import { suggestedEvidenceRanges } from '../../tasks/task-evidence-ranges.js';
import { isTaskEvidenceTool } from '../../tasks/task-evidence-tools.js';

/** Tool-call IDs are protocol metadata and may be invisible to the model; expose the host ID in Task reads. */
export function withTaskEvidenceIdentity<T extends AgentTool>(tool: T): T {
  if (!isTaskEvidenceTool(tool.name)) return tool;
  return { ...tool, execute: async (...args: Parameters<T['execute']>) => {
    const result = await tool.execute(args[0], args[1], args[2], args[3]);
    // Evidence listings/replays and progress messages are not new source observations.
    if (tool.name === 'task_collaboration' && !(result.details as { taskSourceRead?: unknown })?.taskSourceRead) return result;
    const artifacts = (result.details as { artifacts?: Array<{ artifactId: string; title: string; availability: string }> })?.artifacts;
    const receipt = artifacts ? [{ type: 'text' as const, text: JSON.stringify({ publishedArtifacts: artifacts.map(({ artifactId, title, availability }) => ({ artifactId, title, availability })),
      guidance: 'Use exact artifactId values in publish_task_result.finalArtifactIds to select final deliverables.' }) }] : [];
    const execution = result.details as { status?: string; exitCode?: number | null; error?: unknown } | undefined;
    const body = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    const ranges = !(result as { isError?: boolean }).isError && !execution?.error && !['failed', 'blocked', 'error', 'queued', 'running', 'timed_out', 'cancelled'].includes(execution?.status ?? '')
      && (tool.name !== 'managed_job' || execution?.status === 'success' && execution.exitCode === 0)
      ? [{ type: 'text' as const, text: JSON.stringify({ evidence: { toolCallId: args[0], excerptRanges: suggestedEvidenceRanges(body),
        guidance: 'Prefer toolCallId plus excerptRange in publish_task_result.sources; omit excerpt. The host copies exact observed output. For a yielded command cite the successful managed_job completion ID, not the earlier running exec_command. Never rerun completed work merely to obtain evidence. Never reconstruct quoted code, escapes or input commands. This identifies provenance; claim support still requires review.' } }) }] : [];
    const quote = tool.name === 'exec_command' && execution?.status === 'success' && execution.exitCode === 0
      ? [{ type: 'text' as const, text: 'Evidence quoting: copy a short contiguous passage from the output above. The input command is not output; never prepend it to an excerpt. Successful execution and exitCode=0 are host metadata, not extra lines to invent in a quote.' }] : [];
    return { ...result, content: [...result.content, ...receipt, ...quote, ...ranges, { type: 'text' as const, text: `Task source toolCallId: ${args[0]}` }] };
  } } as T;
}
