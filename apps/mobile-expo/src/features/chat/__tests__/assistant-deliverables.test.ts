import {
  appendProductDeliveryText,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { collectAssistantDeliverables } from '../assistant-deliverables';
import type { Message, ToolUseContent } from '../messages.types';
import { parseSessionMessages } from '../session-message-parser';

function messageWithTools(tools: ToolUseContent[]): Message {
  return { role: 'assistant', content: tools };
}

function completedTool(
  name: string,
  details: Record<string, unknown>,
  input: unknown = {},
): ToolUseContent {
  return {
    type: 'tool_use',
    id: `tool-${name}`,
    name,
    input,
    status: 'done',
    result: { content: [{ type: 'text', text: 'done' }], details },
  };
}

describe('assistant deliverables', () => {
  it('collects structured files without an extension allowlist', () => {
    const message = messageWithTools([
      completedTool('write_file', { path: '/tmp/workspace/report.csv' }),
      completedTool('apply_patch', { files: ['config/settings.yaml', 'releases/archive.zip'] }),
      completedTool('create_share', {}, { filePath: 'src/main.py' }),
    ]);

    expect(collectAssistantDeliverables(message, false).workspacePaths.map((path) => (
      path.workspaceRelativePath ?? path.absolutePath
    ))).toEqual([
      '/tmp/workspace/report.csv',
      'config/settings.yaml',
      'releases/archive.zip',
      'src/main.py',
    ]);
  });

  it('falls back to apply_patch changes when the semantic live event has no files array', () => {
    const message = messageWithTools([
      completedTool('apply_patch', {
        files: [],
        changes: [{ path: 'src/new-file.go' }, { moveTo: 'src/renamed.rs' }],
      }),
    ]);

    expect(collectAssistantDeliverables(message, false).workspacePaths.map((path) => (
      path.workspaceRelativePath
    ))).toEqual(['src/new-file.go', 'src/renamed.rs']);
  });

  it('collects generated and sent media from structured tool details', () => {
    const imageMedia = {
      id: 'image-1',
      name: 'cover.png',
      type: 'photo',
      mimeType: 'image/png',
      uri: 'media://outbound/cover.png',
    };
    const documentMedia = {
      id: 'document-1',
      name: 'report.pdf',
      type: 'document',
      mimeType: 'application/pdf',
      uri: 'media://outbound/report.pdf',
    };
    const message = messageWithTools([
      completedTool('image_generate', {
        workspaceRelativePaths: ['media/generated/cover.png'],
        media: [imageMedia],
      }),
      completedTool('send_media', { media: [documentMedia] }),
    ]);

    const deliverables = collectAssistantDeliverables(message, false);
    expect(deliverables.workspacePaths).toEqual([]);
    expect(deliverables.attachments).toEqual([
      expect.objectContaining({ name: 'cover.png', type: 'image', uri: imageMedia.uri }),
      expect.objectContaining({ name: 'report.pdf', type: 'document', uri: documentMedia.uri }),
    ]);
  });

  it('collects non-file product deliveries separately', () => {
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

  it('does not present stale delivery metadata from a failed tool', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 1,
      operation: 'created',
      primary: {
        kind: 'task',
        id: 'task-failed',
        title: 'Failed task',
        capabilities: ['open'],
      },
    };
    const tool: ToolUseContent = {
      type: 'tool_use',
      id: 'failed-tool',
      name: 'xopc_use',
      status: 'error',
      details: { delivery },
      result: 'Failed.',
    };

    expect(collectAssistantDeliverables(messageWithTools([tool]), false).productDeliveries)
      .toEqual([]);
  });

  it('restores the same deliverables from persisted gateway history', () => {
    const [message] = parseSessionMessages([{
      role: 'assistant',
      content: '',
      rawContent: [{
        type: 'toolCall',
        id: 'call-image',
        name: 'image_generate',
        arguments: { prompt: 'a lake' },
      }],
      toolCalls: [{
        id: 'call-image',
        name: 'image_generate',
        args: { prompt: 'a lake' },
        result: 'Generated and attached 1 image.',
        details: {
          workspaceRelativePaths: ['media/generated/lake.png'],
          media: [{
            id: 'lake-1',
            name: 'lake.png',
            type: 'photo',
            mimeType: 'image/png',
            uri: 'media://outbound/lake.png',
          }],
        },
      }],
    }]);

    expect(collectAssistantDeliverables(message, false).attachments).toEqual([
      expect.objectContaining({ name: 'lake.png', uri: 'media://outbound/lake.png' }),
    ]);
  });

  it('projects live and persisted tool results to the same deliverables', () => {
    const details = {
      path: '/tmp/workspace/data/results.parquet',
      media: [{
        id: 'preview-1',
        name: 'preview.webp',
        type: 'photo',
        mimeType: 'image/webp',
        uri: 'media://outbound/preview.webp',
      }],
    };
    const live = messageWithTools([completedTool('write_file', details)]);
    const [persisted] = parseSessionMessages([{
      role: 'assistant',
      content: '',
      toolCalls: [{
        id: 'tool-write_file',
        name: 'write_file',
        args: {},
        result: 'done',
        details,
      }],
    }]);

    const project = (message: Message) => {
      const value = collectAssistantDeliverables(message, false);
      return {
        paths: value.workspacePaths.map((path) => path.workspaceRelativePath ?? path.absolutePath),
        attachments: value.attachments.map((attachment) => attachment.uri),
      };
    };
    expect(project(persisted)).toEqual(project(live));
  });

  it('dedupes a file delivery against the same message attachment', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 1,
      operation: 'created',
      primary: {
        kind: 'file',
        id: 'reports/final.pdf',
        title: 'final.pdf',
        capabilities: ['preview'],
      },
    };
    const message: Message = {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'file-delivery',
        name: 'write_file',
        status: 'done',
        result: appendProductDeliveryText('Done.', delivery),
      }],
      attachments: [{
        name: 'final.pdf',
        type: 'document',
        mimeType: 'application/pdf',
        workspaceRelativePath: 'reports/final.pdf',
      }],
    };

    const deliverables = collectAssistantDeliverables(message, false);
    expect(deliverables.workspacePaths).toHaveLength(1);
    expect(deliverables.attachments).toEqual([]);
    expect(deliverables.productDeliveries).toEqual([]);
  });

  it('marks only active deliverable-producing tools as awaiting', () => {
    const running = (name: string): ToolUseContent => ({
      type: 'tool_use', id: name, name, status: 'running',
    });

    expect(collectAssistantDeliverables(messageWithTools([running('write_file')]), true).awaiting).toBe(true);
    expect(collectAssistantDeliverables(messageWithTools([running('web_search')]), true).awaiting).toBe(false);
    expect(collectAssistantDeliverables(messageWithTools([running('write_file')]), false).awaiting).toBe(false);
  });
});
