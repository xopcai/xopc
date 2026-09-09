import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { collectReferencedAttachmentIds } from '../notes/note-attachment-sync.js';
import type { Note } from '../notes/types.js';
import type { HostedPublicationSnapshot } from './hosted-session-share.js';
import { projectPublicNoteMarkdown, type NoteShareSource } from './note-share-service.js';

const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

export interface HostedNotePublicationSnapshot extends HostedPublicationSnapshot {
  kind: 'note_document';
  sourceNoteId: string;
  sourceVersion: number;
  title: string;
  attachmentCount: number;
}

export class HostedNotePublicationBuilder {
  constructor(private readonly notes: NoteShareSource) {}

  async build(noteId: string, input: {
    expectedNoteVersion?: number;
    attachmentIds?: string[];
    description?: string;
  }): Promise<HostedNotePublicationSnapshot> {
    const note = await this.notes.getNote(noteId);
    if (!note) throw new Error('Note not found');
    if (input.expectedNoteVersion !== undefined && note.updatedAt !== input.expectedNoteVersion) {
      throw new HostedNoteVersionConflictError(note.updatedAt);
    }
    const referenced = collectReferencedAttachmentIds(note);
    const attachments = new Map((note.attachments ?? []).map((attachment) => [attachment.id, attachment]));
    for (const id of referenced) {
      if (!attachments.has(id)) throw new Error(`Referenced attachment is missing: ${id}`);
    }
    const selected = input.attachmentIds === undefined ? [...referenced] : [...new Set(input.attachmentIds)];
    if (selected.length > MAX_ATTACHMENTS) throw new Error('Note has too many attachments to publish');
    for (const id of selected) {
      if (!referenced.has(id)) throw new Error(`Attachment is not referenced by this Note: ${id}`);
    }

    const selectedSet = new Set(selected);
    const markdown = rewritePublicationAssets(projectPublicNoteMarkdown(note, selectedSet), note, selectedSet);
    if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) throw new Error('Note Markdown exceeds publishing limit');
    const assets: HostedPublicationSnapshot['assets'] = [];
    const manifestAttachments: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      size: number;
      sha256: string;
    }> = [];
    let totalBytes = Buffer.byteLength(markdown, 'utf8');
    for (const id of selected) {
      const attachment = attachments.get(id)!;
      if (attachment.size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds publishing limit: ${attachment.fileName}`);
      totalBytes += attachment.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Note publication exceeds total size limit');
      const resolved = await this.notes.getAttachmentPath(note.id, id);
      if (!resolved) throw new Error(`Attachment is missing: ${attachment.fileName}`);
      const current = await stat(resolved.filePath);
      if (!current.isFile() || current.size !== attachment.size) throw new Error(`Attachment changed or is missing: ${attachment.fileName}`);
      assets.push({ id, path: resolved.filePath, size: attachment.size });
      manifestAttachments.push({
        id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        sha256: await sha256File(resolved.filePath),
      });
    }
    return {
      kind: 'note_document',
      sourceNoteId: note.id,
      sourceVersion: note.updatedAt,
      title: note.title?.trim() || 'Untitled Note',
      attachmentCount: assets.length,
      assets,
      manifest: {
        schemaVersion: 1,
        kind: 'note_document',
        title: note.title?.trim() || 'Untitled Note',
        snapshotAt: new Date().toISOString(),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        markdown,
        attachments: manifestAttachments,
      },
    };
  }
}

export class HostedNoteVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super('Note changed after the publication preview was reviewed');
    this.name = 'HostedNoteVersionConflictError';
  }
}

function rewritePublicationAssets(markdown: string, note: Note, selected: Set<string>): string {
  return markdown.replace(
    /xopc-attachment:\/\/notes\/([^/\s)]+)\/([^\s)]+)/gi,
    (match, rawNoteId: string, rawAttachmentId: string) => {
      try {
        const noteId = decodeURIComponent(rawNoteId);
        const attachmentId = decodeURIComponent(rawAttachmentId);
        return noteId === note.id && selected.has(attachmentId)
          ? `xopc-publication-asset://${attachmentId}`
          : match;
      } catch {
        return match;
      }
    },
  );
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}
