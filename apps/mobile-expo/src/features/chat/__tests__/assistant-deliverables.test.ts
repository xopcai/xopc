import {
  appendProductDeliveryText,
  fileResourceArtifactUri,
  type ProductDeliveryEnvelope,
  type TurnOutcome,
  type TurnOutcomeDeliverable,
} from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { collectAssistantDeliverables } from '../assistant-deliverables';
import { artifactFileId } from '../artifact-uri';
import type { Message, ToolUseContent } from '../messages.types';

function outcome(deliverables: TurnOutcomeDeliverable[]): TurnOutcome {
  return {
    version: 1,
    outcomeId: 'outcome-1',
    runId: 'run-1',
    turnId: 'turn-1',
    status: 'succeeded',
    deliverables,
    evidence: [],
    createdAt: '2026-09-03T00:00:00.000Z',
  };
}

function messageWithTools(tools: ToolUseContent[]): Message {
  return { role: 'assistant', content: tools };
}

describe('assistant deliverables', () => {
  it('uses canonical turn outcome artifacts and dedupes by artifact id', () => {
    const artifact: TurnOutcomeDeliverable = {
      artifactId: 'space-id.cmVwb3J0cy9maW5hbC54bHN4',
      title: 'final.xlsx',
      kind: 'spreadsheet',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      availability: 'available',
      location: 'workspace',
      capabilities: ['preview', 'download'],
      uri: fileResourceArtifactUri('space-id.cmVwb3J0cy9maW5hbC54bHN4'),
      workspaceRelativePath: 'reports/final.xlsx',
    };
    const message: Message = {
      role: 'assistant',
      content: [],
      outcome: outcome([artifact, { ...artifact, title: 'duplicate.xlsx' }]),
    };

    expect(collectAssistantDeliverables(message, false).artifacts).toEqual([{
      ...artifact,
      title: 'duplicate.xlsx',
    }]);
  });

  it('decodes an encoded file resource id without treating it as a path', () => {
    const fileId = 'space-id.cmVwb3J0cy9maW5hbC54bHN4';

    expect(artifactFileId(fileResourceArtifactUri(fileId))).toBe(fileId);
    expect(artifactFileId('reports/final.xlsx')).toBeNull();
  });

  it('keeps non-file product deliveries separate from turn artifacts', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 1,
      operation: 'created',
      primary: {
        kind: 'task',
        id: 'task-1',
        title: 'Launch task',
        capabilities: ['open', 'continue_in_chat'],
      },
    };
    const tool: ToolUseContent = {
      type: 'tool_use',
      id: 'task-tool',
      name: 'xopc_use',
      status: 'done',
      result: appendProductDeliveryText('Created task.', delivery),
    };

    expect(collectAssistantDeliverables(messageWithTools([tool]), false).productDeliveries)
      .toEqual([delivery]);
  });

  it('does not repeat audio already rendered in the assistant message', () => {
    const uri = 'media://tts/assist.mp3';
    const artifact: TurnOutcomeDeliverable = {
      artifactId: 'voice-1',
      title: 'assist.mp3',
      kind: 'audio',
      availability: 'available',
      location: 'artifact_store',
      capabilities: ['preview', 'download'],
      uri,
    };
    const message: Message = {
      role: 'assistant',
      content: [{ type: 'audio', uri, name: 'assist.mp3' }],
      outcome: outcome([artifact]),
    };

    expect(collectAssistantDeliverables(message, false).artifacts).toEqual([]);
  });

  it('does not infer file artifacts from product delivery ids', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 1,
      operation: 'created',
      primary: {
        kind: 'file',
        id: 'space-id.cmVwb3J0cy9maW5hbC54bHN4',
        title: 'final.xlsx',
        capabilities: ['preview'],
      },
    };
    const tool: ToolUseContent = {
      type: 'tool_use',
      id: 'file-tool',
      name: 'write_file',
      status: 'done',
      result: appendProductDeliveryText('Created file.', delivery),
    };

    expect(collectAssistantDeliverables(messageWithTools([tool]), false)).toMatchObject({
      artifacts: [],
      productDeliveries: [],
    });
  });

  it('marks active artifact-producing tools as awaiting an outcome', () => {
    const running = (name: string): ToolUseContent => ({
      type: 'tool_use', id: name, name, status: 'running',
    });

    expect(collectAssistantDeliverables(messageWithTools([running('publish_artifacts')]), true).awaiting)
      .toBe(true);
    expect(collectAssistantDeliverables(messageWithTools([running('exec_command')]), true).awaiting)
      .toBe(true);
    expect(collectAssistantDeliverables(messageWithTools([running('web_search')]), true).awaiting)
      .toBe(false);
  });
});
