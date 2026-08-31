import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { resolveStateDir } from '../config/paths.js';
import { collectReferencedAttachmentIds } from '../notes/note-attachment-sync.js';
import type { Note, NoteAttachment } from '../notes/types.js';
import { createLogger } from '../utils/logger.js';
import type { NoteShareRecord } from './share-types.js';
import type { ShareStore } from './share-store.js';

const log = createLogger('NoteShareService');
const MANIFEST_SCHEMA_VERSION = 1;

export interface NoteShareManifestAttachment {
  id: string;
  type: NoteAttachment['type'];
  mimeType: string;
  fileName: string;
  size: number;
  artifactFileName: string;
  checksum: string;
  duration?: number;
}

export interface NoteShareManifest {
  schemaVersion: 1;
  shareId: string;
  source: { noteId: string; noteVersion: number };
  title: string;
  markdown: string;
  snapshotAt: string;
  attachments: NoteShareManifestAttachment[];
}

export interface NoteShareSource {
  getNote(id: string): Promise<Note | null>;
  getAttachmentPath(noteId: string, attachmentId: string): Promise<{
    filePath: string;
    mimeType: string;
    fileName: string;
  } | null>;
}

export interface CreateNoteShareInput {
  expectedNoteVersion?: number;
  attachmentIds?: string[];
  ttlMs?: number;
  maxViews?: number | null;
  description?: string;
  gatewayTokenHash: string;
}

export class NoteShareVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super('Note changed after the share preview was reviewed');
    this.name = 'NoteShareVersionConflictError';
  }
}

export class NoteShareService {
  constructor(
    private readonly store: ShareStore,
    private readonly notes: NoteShareSource,
  ) {}

  async create(noteId: string, input: CreateNoteShareInput): Promise<NoteShareRecord> {
    const note = await this.requireNote(noteId, input.expectedNoteVersion);
    const id = randomUUID();
    const staged = await this.buildArtifact(id, note, input.attachmentIds);
    try {
      return this.store.createNoteShare({
        id,
        sourceNoteId: note.id,
        sourceVersion: note.updatedAt,
        artifactRelativePath: this.artifactRelativePath(id),
        artifactSize: staged.totalSize,
        attachmentCount: staged.manifest.attachments.length,
        fileName: staged.manifest.title,
        ttlMs: input.ttlMs,
        maxViews: input.maxViews,
        description: input.description,
        gatewayTokenHash: input.gatewayTokenHash,
      });
    } catch (error) {
      await this.removeArtifact(id);
      throw error;
    }
  }

  async refresh(noteId: string, shareId: string, input: Pick<CreateNoteShareInput, 'expectedNoteVersion' | 'attachmentIds'>): Promise<NoteShareRecord> {
    const record = this.store.getById(shareId);
    if (!record || record.kind !== 'note' || record.sourceNoteId !== noteId) {
      throw new Error('Note share not found');
    }
    const note = await this.requireNote(noteId, input.expectedNoteVersion);
    const finalDir = this.artifactDir(shareId);
    const stagedDir = `${finalDir}.refresh-${randomUUID()}`;
    const backupDir = `${finalDir}.backup-${randomUUID()}`;
    const staged = await this.buildArtifact(shareId, note, input.attachmentIds, stagedDir);
    let movedOld = false;
    try {
      await rename(finalDir, backupDir);
      movedOld = true;
      await rename(stagedDir, finalDir);
      const updated = this.store.updateNoteSnapshot(shareId, {
        sourceVersion: note.updatedAt,
        artifactSize: staged.totalSize,
        attachmentCount: staged.manifest.attachments.length,
        fileName: staged.manifest.title,
      });
      if (!updated) throw new Error('Note share not found');
      await rm(backupDir, { recursive: true, force: true });
      return updated;
    } catch (error) {
      await rm(stagedDir, { recursive: true, force: true });
      if (movedOld) {
        await rm(finalDir, { recursive: true, force: true });
        await rename(backupDir, finalDir).catch(() => undefined);
      }
      throw error;
    }
  }

  list(noteId: string): NoteShareRecord[] {
    return this.store.getNoteShares(noteId);
  }

  async revokeForNote(noteId: string): Promise<number> {
    const active = this.store.getNoteShares(noteId).filter((record) => !record.revoked);
    const count = this.store.revokeMany(active.map((record) => record.id));
    await Promise.all(active.map((record) => this.removeArtifact(record.id)));
    return count;
  }

  async removeArtifact(shareId: string): Promise<void> {
    await rm(this.artifactDir(shareId), { recursive: true, force: true }).catch((err) => {
      log.warn({ err, shareId }, 'Failed to remove Note share artifact');
    });
  }

  async readManifest(record: NoteShareRecord): Promise<NoteShareManifest> {
    const raw = await readFile(join(resolveStateDir(), record.artifactRelativePath, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw) as NoteShareManifest;
    if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || manifest.shareId !== record.id) {
      throw new Error('Invalid Note share artifact');
    }
    return manifest;
  }

  issueAssetTicket(record: NoteShareRecord): string {
    const expiresAt = Date.now() + this.store.getConfig().note.assetTicketTtlMs;
    const payload = Buffer.from(JSON.stringify({
      shareId: record.id,
      revision: record.snapshotRevision,
      expiresAt,
    })).toString('base64url');
    const signature = createHmac('sha256', record.assetTicketSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  verifyAssetTicket(record: NoteShareRecord, ticket: string): boolean {
    const [payload, signature] = ticket.split('.');
    if (!payload || !signature) return false;
    const expected = createHmac('sha256', record.assetTicketSecret).update(payload).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, 'base64url');
    } catch {
      return false;
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        shareId?: unknown;
        revision?: unknown;
        expiresAt?: unknown;
      };
      return value.shareId === record.id &&
        value.revision === record.snapshotRevision &&
        typeof value.expiresAt === 'number' &&
        Date.now() < value.expiresAt;
    } catch {
      return false;
    }
  }

  async resolveAsset(record: NoteShareRecord, attachmentId: string): Promise<{
    path: string;
    attachment: NoteShareManifestAttachment;
  } | null> {
    const manifest = await this.readManifest(record);
    const attachment = manifest.attachments.find((item) => item.id === attachmentId);
    if (!attachment || attachment.artifactFileName !== attachment.id) return null;
    return {
      path: join(resolveStateDir(), record.artifactRelativePath, 'assets', attachment.artifactFileName),
      attachment,
    };
  }

  publicMarkdown(record: NoteShareRecord, manifest: NoteShareManifest, ticket: string): string {
    return manifest.markdown.replace(
      /xopc-attachment:\/\/notes\/([^/]+)\/([^\s)]+)/gi,
      (_match, noteId: string, attachmentId: string) => {
        let decodedNoteId = noteId;
        let decodedAttachmentId = attachmentId;
        try {
          decodedNoteId = decodeURIComponent(noteId);
          decodedAttachmentId = decodeURIComponent(attachmentId);
        } catch {
          return '#invalid-attachment';
        }
        if (decodedNoteId !== record.sourceNoteId || !manifest.attachments.some((item) => item.id === decodedAttachmentId)) {
          return '#attachment-not-shared';
        }
        return `/s/${encodeURIComponent(record.token)}/assets/${encodeURIComponent(decodedAttachmentId)}?ticket=${encodeURIComponent(ticket)}`;
      },
    );
  }

  private async requireNote(noteId: string, expectedVersion?: number): Promise<Note> {
    const note = await this.notes.getNote(noteId);
    if (!note) throw new Error('Note not found');
    if (expectedVersion !== undefined && note.updatedAt !== expectedVersion) {
      throw new NoteShareVersionConflictError(note.updatedAt);
    }
    return note;
  }

  private async buildArtifact(
    shareId: string,
    note: Note,
    requestedAttachmentIds?: string[],
    targetDir = this.artifactDir(shareId),
  ): Promise<{ manifest: NoteShareManifest; totalSize: number }> {
    const cfg = this.store.getConfig().note;
    if (!cfg.enabled) throw new Error('Note sharing is disabled');
    const referenced = collectReferencedAttachmentIds(note);
    const known = new Map((note.attachments ?? []).map((attachment) => [attachment.id, attachment]));
    for (const id of referenced) {
      if (!known.has(id)) throw new Error(`Referenced attachment is missing: ${id}`);
    }
    const selected = requestedAttachmentIds === undefined
      ? [...referenced]
      : Array.from(new Set(requestedAttachmentIds));
    for (const id of selected) {
      if (!referenced.has(id)) throw new Error(`Attachment is not referenced by this Note: ${id}`);
    }
    const projectedMarkdown = projectPublicMarkdown(note, new Set(selected));
    const markdownBytes = Buffer.byteLength(projectedMarkdown, 'utf8');
    if (markdownBytes > cfg.maxMarkdownBytes) throw new Error('Note Markdown exceeds sharing limit');
    if (selected.length > cfg.maxAttachmentCount) throw new Error('Note has too many attachments to share');

    const tempDir = targetDir === this.artifactDir(shareId) ? `${targetDir}.tmp-${randomUUID()}` : targetDir;
    const assetsDir = join(tempDir, 'assets');
    await rm(tempDir, { recursive: true, force: true });
    await mkdir(assetsDir, { recursive: true, mode: 0o700 });
    let totalSize = markdownBytes;
    const attachments: NoteShareManifestAttachment[] = [];
    try {
      for (const id of selected) {
        const source = known.get(id)!;
        if (source.size > cfg.maxAttachmentSize) throw new Error(`Attachment exceeds sharing limit: ${source.fileName}`);
        totalSize += source.size;
        if (totalSize > cfg.maxTotalSize) throw new Error('Note share exceeds total size limit');
        const resolved = await this.notes.getAttachmentPath(note.id, id);
        if (!resolved) throw new Error(`Attachment is missing: ${source.fileName}`);
        const fileStat = await stat(resolved.filePath);
        if (!fileStat.isFile() || fileStat.size !== source.size) throw new Error(`Attachment changed or is missing: ${source.fileName}`);
        const bytes = await readFile(resolved.filePath);
        const checksum = createHash('sha256').update(bytes).digest('hex');
        await copyFile(resolved.filePath, join(assetsDir, id));
        attachments.push({
          id,
          type: source.type,
          mimeType: source.mimeType,
          fileName: source.fileName,
          size: source.size,
          artifactFileName: id,
          checksum,
          duration: source.duration,
        });
      }
      const title = note.title?.trim() || 'Untitled Note';
      const manifest: NoteShareManifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        shareId,
        source: { noteId: note.id, noteVersion: note.updatedAt },
        title,
        markdown: projectedMarkdown,
        snapshotAt: new Date().toISOString(),
        attachments,
      };
      await writeFile(join(tempDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      if (tempDir !== targetDir) {
        await mkdir(dirname(targetDir), { recursive: true, mode: 0o700 });
        await rename(tempDir, targetDir);
      }
      return { manifest, totalSize };
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  private artifactRelativePath(shareId: string): string {
    return join('share-artifacts', shareId);
  }

  private artifactDir(shareId: string): string {
    return join(resolveStateDir(), this.artifactRelativePath(shareId));
  }
}

function projectPublicMarkdown(note: Note, selected: Set<string>): string {
  const canonicalTarget = 'xopc-attachment://notes/([^/\\s)]+)/([^\\s)]+)';
  const assertOwned = new RegExp(canonicalTarget, 'gi');
  note.markdown.replace(assertOwned, (_match, rawNoteId: string) => {
    let noteId: string;
    try { noteId = decodeURIComponent(rawNoteId); } catch { throw new Error('Invalid Note attachment reference'); }
    if (noteId !== note.id) throw new Error('Cross-Note attachment references cannot be shared');
    return _match;
  });

  const projectTarget = (rawNoteId: string, rawAttachmentId: string): boolean => {
    try {
      return decodeURIComponent(rawNoteId) === note.id && selected.has(decodeURIComponent(rawAttachmentId));
    } catch {
      return false;
    }
  };
  let markdown = note.markdown.replace(
    new RegExp(`!\\[([^\\]]*)\\]\\(${canonicalTarget}\\)`, 'gi'),
    (_match, alt: string, rawNoteId: string, rawAttachmentId: string) =>
      projectTarget(rawNoteId, rawAttachmentId) ? _match : `_[Attachment not shared${alt ? `: ${alt}` : ''}]_`,
  );
  markdown = markdown.replace(
    new RegExp(`\\[([^\\]]+)\\]\\(${canonicalTarget}\\)`, 'gi'),
    (_match, label: string, rawNoteId: string, rawAttachmentId: string) =>
      projectTarget(rawNoteId, rawAttachmentId) ? _match : label,
  );
  return markdown;
}
