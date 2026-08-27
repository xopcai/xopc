import { describe, expect, it } from 'vitest';

import { parseSessionMessages } from '../session-message-parser';

function toolBlock(messages: ReturnType<typeof parseSessionMessages>) {
  return messages[0]?.content.find((block) => block.type === 'tool_use');
}

describe('session message deliverable restoration', () => {
  it('merges persisted tool result fields into the matching raw tool block', () => {
    const messages = parseSessionMessages([
      {
        role: 'assistant',
        content: '',
        rawContent: [{
          type: 'toolCall',
          id: 'call-write',
          name: 'write_file',
          arguments: { path: 'report.csv' },
        }],
        toolCalls: [{
          id: 'call-write',
          name: 'write_file',
          args: { path: 'report.csv' },
          result: 'File written: /tmp/workspace/report.csv',
          details: { path: '/tmp/workspace/report.csv' },
        }],
      },
    ]);

    expect(toolBlock(messages)).toMatchObject({
      type: 'tool_use',
      id: 'call-write',
      name: 'write_file',
      status: 'done',
      result: 'File written: /tmp/workspace/report.csv',
      details: { path: '/tmp/workspace/report.csv' },
    });
  });

  it('restores completed and failed tools without raw content', () => {
    const completed = toolBlock(parseSessionMessages([{
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'ok', name: 'send_media', result: 'attached', details: { media: [] } }],
    }]));
    const failed = toolBlock(parseSessionMessages([{
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'bad', name: 'send_media', result: 'failed', isError: true }],
    }]));

    expect(completed).toMatchObject({ id: 'ok', status: 'done', result: 'attached' });
    expect(failed).toMatchObject({ id: 'bad', status: 'error', result: 'failed' });
  });

  it('keeps a result-less raw tool call running', () => {
    const block = toolBlock(parseSessionMessages([{
      role: 'assistant',
      content: '',
      rawContent: [{ type: 'toolCall', id: 'pending', name: 'write_file', arguments: {} }],
      toolCalls: [{ id: 'pending', name: 'write_file', args: {} }],
    }]));

    expect(block).toMatchObject({ id: 'pending', status: 'running' });
  });

  it('unions attachments and media and preserves media metadata', () => {
    const [message] = parseSessionMessages([{
      role: 'assistant',
      content: 'Done.',
      attachments: [{ name: 'report.pdf', mimeType: 'application/pdf' }],
      media: [{
        id: 'image-1',
        name: 'cover.png',
        type: 'photo',
        mimeType: 'image/png',
        uri: 'media://outbound/cover.png',
        bucket: 'outbound',
        path: '/state/media/outbound/cover.png',
      }],
    }]);

    expect(message.attachments).toEqual([
      expect.objectContaining({ name: 'report.pdf', mimeType: 'application/pdf' }),
      expect.objectContaining({
        name: 'cover.png',
        type: 'image',
        uri: 'media://outbound/cover.png',
        bucket: 'outbound',
        path: '/state/media/outbound/cover.png',
      }),
    ]);
  });

  it('merges duplicate attachment metadata and ignores empty wire entries', () => {
    const [message] = parseSessionMessages([{
      role: 'assistant',
      content: 'Done.',
      attachments: [{ id: 'file-1', name: 'report.pdf' }, {}],
      media: [{
        id: 'file-1',
        name: 'report.pdf',
        type: 'document',
        mimeType: 'application/pdf',
        uri: 'media://outbound/report.pdf',
      }],
    }]);

    expect(message.attachments).toEqual([expect.objectContaining({
      id: 'file-1',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      uri: 'media://outbound/report.pdf',
    })]);
  });

  it('merges attachments from consecutive assistant fragments', () => {
    const [message] = parseSessionMessages([
      {
        role: 'assistant',
        content: 'First',
        attachments: [{ name: 'first.pdf', mimeType: 'application/pdf' }],
      },
      {
        role: 'assistant',
        content: 'Second',
        attachments: [{ name: 'second.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
      },
    ]);

    expect(message.attachments?.map((attachment) => attachment.name)).toEqual([
      'first.pdf',
      'second.xlsx',
    ]);
  });
});
