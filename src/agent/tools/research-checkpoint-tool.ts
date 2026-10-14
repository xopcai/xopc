import type { AgentTool } from '@earendil-works/pi-agent-core';

import { ResearchCheckpointUpdateSchema, type ResearchCheckpointSink, type ResearchCheckpointUpdate } from '../orchestration/research-checkpoint.js';

export function createResearchCheckpointTool(sink: ResearchCheckpointSink): AgentTool<typeof ResearchCheckpointUpdateSchema> {
  return {
    name: 'research_checkpoint', label: 'Save research checkpoint',
    description: 'Persist findings immediately after verifying each source. Use stable finding ids to update fields; omitted findings are retained. Include public source URLs for confirmed claims. not_disclosed is a valid result; never invent missing prices or limits. nextSteps replaces the unfinished-work list; set it to [] only when all requested fields are addressed, including explicitly undisclosed fields. This writes only this delegated research checkpoint.',
    parameters: ResearchCheckpointUpdateSchema,
    async execute(_id: string, update: ResearchCheckpointUpdate, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const checkpoint = sink.save(update);
      return { content: [{ type: 'text', text: JSON.stringify({ saved: true, findingCount: checkpoint.findings.length, nextSteps: checkpoint.nextSteps }) }], details: {} };
    },
  };
}
