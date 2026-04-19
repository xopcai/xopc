import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/agent-messages';
import { inferAttachmentFileType, inferMimeTypeFromFileName } from '@/features/chat/attachment-utils-core';

describe('inferAttachmentFileType', () => {
  it('detects PDF from extension when mime is application/octet-stream', () => {
    expect(
      inferAttachmentFileType({
        name: 'report.pdf',
        mimeType: 'application/octet-stream',
      }),
    ).toBe('pdf');
  });

  it('detects DOCX from extension when mime is generic', () => {
    expect(
      inferAttachmentFileType({
        name: 'Notes.DOCX',
        mimeType: 'application/octet-stream',
      }),
    ).toBe('docx');
  });

  it('prefers office types over image extension false positives', () => {
    expect(
      inferAttachmentFileType({
        name: 'file.xlsx',
        mimeType: 'application/octet-stream',
      }),
    ).toBe('excel');
  });
});

describe('inferMimeTypeFromFileName', () => {
  it('maps common extensions', () => {
    expect(inferMimeTypeFromFileName('a.pdf')).toBe('application/pdf');
    expect(inferMimeTypeFromFileName('b.png')).toBe('image/png');
  });
});

describe('normalizeAgentMessages attachment mime from filename', () => {
  it('upgrades octet-stream to application/pdf when name ends with .pdf', () => {
    const ui = normalizeAgentMessages([
      {
        role: 'user-with-attachments',
        content: [{ type: 'text', text: 'hi' }],
        attachments: [
          {
            name: 'x.pdf',
            mimeType: 'application/octet-stream',
            data: 'AA==',
          },
        ],
        timestamp: 1,
      },
    ]);
    const att = ui[0]?.attachments?.[0];
    expect(att?.mimeType).toBe('application/pdf');
  });
});
