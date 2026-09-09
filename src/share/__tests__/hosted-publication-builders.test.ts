import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Note } from '../../notes/types.js';
import { HostedNotePublicationBuilder, HostedNoteVersionConflictError } from '../hosted-note-publication.js';
import { HostedStaticSitePublicationBuilder } from '../hosted-static-site-publication.js';

const root = join(tmpdir(), `xopc-hosted-publication-builders-${process.pid}`);

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('hosted Publication builders', () => {
  it('projects a Note into a closed public manifest', async () => {
    const attachmentPath = join(root, 'private-image.png');
    writeFileSync(attachmentPath, 'image-bytes');
    const note: Note = {
      id: 'note-1',
      title: 'Public note',
      kind: 'thought',
      status: 'inbox',
      markdown: '![diagram](xopc-attachment://notes/note-1/asset-1)',
      attachments: [{
        id: 'asset-1', type: 'image', mimeType: 'image/png', fileName: 'diagram.png',
        size: 11, relativePath: 'private-image.png',
      }],
      createdAt: 1,
      updatedAt: 2,
      capturedVia: { channel: 'web' },
    };
    const builder = new HostedNotePublicationBuilder({
      getNote: async () => note,
      getAttachmentPath: async () => ({ filePath: attachmentPath, mimeType: 'image/png', fileName: 'diagram.png' }),
    });

    const snapshot = await builder.build(note.id, { expectedNoteVersion: 2, attachmentIds: ['asset-1'] });
    expect(snapshot).toMatchObject({ kind: 'note_document', sourceNoteId: 'note-1', sourceVersion: 2, attachmentCount: 1 });
    expect(snapshot.manifest).toMatchObject({
      kind: 'note_document',
      markdown: '![diagram](xopc-publication-asset://asset-1)',
      attachments: [{ id: 'asset-1', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }],
    });
    await expect(builder.build(note.id, { expectedNoteVersion: 1 })).rejects.toBeInstanceOf(HostedNoteVersionConflictError);
  });

  it('builds a deterministic static-site manifest and rejects symlinks', async () => {
    const site = join(root, 'dist');
    mkdirSync(join(site, 'assets'), { recursive: true });
    writeFileSync(join(site, 'index.html'), '<h1>Hello</h1>');
    writeFileSync(join(site, 'assets', 'app.js'), 'document.body.dataset.ready="yes"');
    const builder = new HostedStaticSitePublicationBuilder();

    const snapshot = await builder.build(root, { path: 'dist', title: 'Website' });
    expect(snapshot).toMatchObject({ kind: 'static_site', title: 'Website', fileCount: 2 });
    expect(snapshot.manifest).toMatchObject({
      kind: 'static_site',
      entrypoint: 'index.html',
      files: [
        { path: 'assets/app.js', mimeType: 'text/javascript' },
        { path: 'index.html', mimeType: 'text/html' },
      ],
    });

    symlinkSync(join(site, 'index.html'), join(site, 'linked.html'));
    await expect(builder.build(root, { path: 'dist' })).rejects.toThrow('symbolic links');
  });

  it('publishes a single HTML file as the site entrypoint', async () => {
    writeFileSync(join(root, 'report.html'), '<html><title>Report</title></html>');
    const builder = new HostedStaticSitePublicationBuilder();

    const snapshot = await builder.build(root, { path: 'report.html' });

    expect(snapshot).toMatchObject({ kind: 'static_site', title: 'report', fileCount: 1 });
    expect(snapshot.manifest).toMatchObject({
      entrypoint: 'index.html',
      files: [{ path: 'index.html', mimeType: 'text/html' }],
    });
    expect(snapshot.assets[0]?.path).toBe(realpathSync(join(root, 'report.html')));
  });

  it('rejects a non-HTML file passed as a standalone website', async () => {
    writeFileSync(join(root, 'report.txt'), 'not html');
    const builder = new HostedStaticSitePublicationBuilder();

    await expect(builder.build(root, { path: 'report.txt' })).rejects.toThrow('HTML document');
  });
});
