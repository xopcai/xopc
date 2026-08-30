import { describe, expect, it } from 'vitest';

import { normalizeConnectedSourceResult } from '../connected-source-normalizers.js';

describe('connected source normalizers', () => {
  it('extracts bounded Gmail headers and plain-text payload content', () => {
    const body = Buffer.from('Project Atlas is preparing the September launch.').toString('base64url');
    const entities = normalizeConnectedSourceResult({
      toolkit: 'gmail',
      actionId: 'GMAIL_FETCH_EMAILS',
      result: { data: { messages: [{
        id: 'mail-1',
        payload: {
          headers: [
            { name: 'Subject', value: 'Atlas launch review' },
            { name: 'From', value: 'lead@example.com' },
          ],
          parts: [{ mimeType: 'text/plain', body: { data: body } }],
        },
      }] } },
    });

    expect(entities[0]).toMatchObject({
      itemType: 'email',
      value: {
        subject: 'Atlas launch review',
        sender: 'lead@example.com',
        content: 'Project Atlas is preparing the September launch.',
      },
    });
  });

  it('normalizes Google Drive metadata without reading file content', () => {
    const entities = normalizeConnectedSourceResult({
      toolkit: 'googledrive',
      actionId: 'GOOGLEDRIVE_FIND_FILE',
      result: {
        data: {
          files: [{
            id: 'doc-1',
            name: 'Atlas launch brief',
            mimeType: 'application/vnd.google-apps.document',
            modifiedTime: '2026-08-25T08:00:00.000Z',
            owners: [{ emailAddress: 'owner@example.com' }],
            webViewLink: 'https://docs.google.com/document/d/doc-1/edit',
          }],
        },
      },
    });

    expect(entities).toEqual([expect.objectContaining({
      externalId: 'doc-1',
      itemType: 'cloud_document',
      value: expect.objectContaining({ title: 'Atlas launch brief' }),
      metadata: expect.objectContaining({
        observationKind: 'document_metadata',
        mimeType: 'application/vnd.google-apps.document',
      }),
      synthesisStatus: 'ignored',
    })]);
    expect(JSON.stringify(entities)).not.toContain('content');
  });

  it('turns cancelled calendar sync events into tombstones', () => {
    expect(normalizeConnectedSourceResult({
      toolkit: 'googlecalendar',
      actionId: 'GOOGLECALENDAR_SYNC_EVENTS',
      result: { data: { items: [{ id: 'event-removed', status: 'cancelled', updated: '2026-08-25T08:00:00Z' }] } },
    })).toEqual([expect.objectContaining({
      externalId: 'event-removed',
      deletedAt: '2026-08-25T08:00:00.000Z',
    })]);
  });
});
