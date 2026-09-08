import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';
import { inferMimeTypeFromFileName } from '@/features/chat/attachments/attachment-utils-core';
import { detectPreviewFileType } from '@/features/preview-runtime';
import { normalizeWireMedia } from '@/features/chat/messages/wire-attachments';

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

  it('detects common editable source and dotfiles with a generic mime type', () => {
    expect(detectPreviewFileType('.env', 'application/octet-stream')).toBe('text');
    expect(detectPreviewFileType('.env.local', 'application/octet-stream')).toBe('text');
    expect(detectPreviewFileType('deploy.sh', 'application/octet-stream')).toBe('code');
    expect(detectPreviewFileType('Dockerfile', 'application/octet-stream')).toBe('code');
    expect(detectPreviewFileType('Dockerfile.dev', 'application/octet-stream')).toBe('code');
    expect(detectPreviewFileType('/workspace/.config/README', 'application/octet-stream')).toBe('text');
    expect(detectPreviewFileType('notes.custom', 'text/plain')).toBe('text');
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

describe('normalizeWireMedia', () => {
  it('preserves the pasted text attachment type across session hydration', () => {
    expect(
      normalizeWireMedia([
        {
          type: 'pasted_text',
          name: 'pasted-text.html',
          mimeType: 'text/html',
          uri: 'media://inbound/pasted-text.html',
        },
      ])?.[0],
    ).toMatchObject({ type: 'pasted_text', name: 'pasted-text.html', mimeType: 'text/html' });
  });
});
