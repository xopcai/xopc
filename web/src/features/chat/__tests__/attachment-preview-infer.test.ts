import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';
import { inferMimeTypeFromFileName } from '@/features/chat/attachments/attachment-utils-core';
import { detectPreviewFileType } from '@/features/preview-runtime';

describe('detectPreviewFileType', () => {
  it('detects PDF from extension when mime is application/octet-stream', () => {
    expect(detectPreviewFileType('report.pdf', 'application/octet-stream')).toBe('pdf');
  });

  it('detects DOCX from extension when mime is generic', () => {
    expect(detectPreviewFileType('Notes.DOCX', 'application/octet-stream')).toBe('docx');
  });

  it('prefers office types over image extension false positives', () => {
    expect(detectPreviewFileType('file.xlsx', 'application/octet-stream')).toBe('spreadsheet');
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
        role: 'user',
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
