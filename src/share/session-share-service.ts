import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename, join } from 'node:path';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';

import { resolveStateDir } from '../config/paths.js';
import { resolveMediaReference } from '../media/media-reference.js';
import type { SessionMetadata } from '../session/types.js';
import type { CompactionSourceSnapshot } from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import { issueShareAssetTicket, verifyShareAssetTicket } from './share-asset-ticket.js';
import {
  projectSessionShare,
  type SessionShareAttachmentCandidate,
  type SessionShareMessage,
  type SessionShareToolActivity,
} from './session-share-projector.js';
import type { ShareStore } from './share-store.js';
import type { SessionShareRecord } from './share-types.js';

const log = createLogger('SessionShareService');
const MANIFEST_SCHEMA_VERSION = 1;
const MAX_SHARE_MESSAGES = 10_000;
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 20;
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const ASSET_TICKET_TTL_MS = 10 * 60_000;

export interface SessionShareManifestAttachment {
  id: string;
  messageId: string;
  mimeType: string;
  fileName: string;
  size: number;
  artifactFileName: string;
  checksum: string;
}

export interface SessionShareManifest {
  schemaVersion: 1;
  shareId: string;
  source: { sessionId: string; cutoffSeq: number };
  title: string;
  snapshotAt: string;
  messages: SessionShareMessage[];
  toolActivities: SessionShareToolActivity[];
  attachments: SessionShareManifestAttachment[];
}

export interface SessionShareSource {
  getMetadata(sessionKey: string): Promise<SessionMetadata | null>;
  getSnapshot(sessionKey: string): Promise<CompactionSourceSnapshot | null>;
}

export interface SessionSharePreview {
  sessionId: string;
  cutoffSeq: number;
  metadataUpdatedAt: string;
  title: string;
  snapshotAt: string;
  messageCount: number;
  messages: SessionShareMessage[];
  toolActivities: SessionShareToolActivity[];
  attachmentCandidates: SessionShareAttachmentCandidate[];
}

export interface CreateSessionShareInput {
  expectedSessionId: string;
  expectedCutoffSeq: number;
  expectedMetadataUpdatedAt: string;
  includeToolActivities?: boolean;
  attachmentIds?: string[];
  ttlMs?: number;
  maxViews?: number | null;
  description?: string;
  gatewayTokenHash: string;
}

export interface RefreshSessionShareInput {
  expectedSessionId: string;
  expectedCutoffSeq: number;
  expectedMetadataUpdatedAt: string;
  includeToolActivities?: boolean;
  attachmentIds?: string[];
}

export class SessionShareSnapshotConflictError extends Error {
  constructor() {
    super('Session changed after the share preview was reviewed');
    this.name = 'SessionShareSnapshotConflictError';
  }
}

export class SessionShareService {
  constructor(
    private readonly store: ShareStore,
    private readonly source: SessionShareSource,
  ) {}

  async preview(sessionKey: string): Promise<SessionSharePreview> {
    const source = await this.loadSource(sessionKey);
    const projection = projectSessionShare(source.snapshot.entries);
    this.validateMessages(projection.messages);
    return {
      sessionId: source.snapshot.sessionId,
      cutoffSeq: source.snapshot.lastSeq,
      metadataUpdatedAt: source.metadata.updatedAt,
      title: source.metadata.name?.trim() || 'Shared conversation',
      snapshotAt: new Date().toISOString(),
      messageCount: projection.messages.length,
      messages: projection.messages,
      toolActivities: projection.toolActivities,
      attachmentCandidates: projection.attachmentCandidates,
    };
  }

  async create(sessionKey: string, input: CreateSessionShareInput): Promise<SessionShareRecord> {
    const source = await this.loadExpectedSource(sessionKey, input);
    const id = randomUUID();
    const projection = projectSessionShare(source.snapshot.entries);
    const includeToolActivities = input.includeToolActivities === true;
    const manifestBase = this.buildManifestBase(id, source, projection, {
      includeToolActivities,
      selectedAttachmentIds: input.attachmentIds ?? [],
    });
    const built = await this.createArtifact(id, manifestBase, projection, input.attachmentIds ?? []);
    try {
      return this.store.createSessionShare({
        id,
        sourceSessionId: built.manifest.source.sessionId,
        cutoffSeq: built.manifest.source.cutoffSeq,
        artifactRelativePath: this.artifactRelativePath(id),
        artifactSize: built.totalSize,
        messageCount: built.manifest.messages.length,
        attachmentCount: built.manifest.attachments.length,
        includeToolActivities,
        fileName: built.manifest.title,
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

  async refresh(sessionKey: string, shareId: string, input: RefreshSessionShareInput): Promise<SessionShareRecord> {
    const record = this.store.getById(shareId);
    if (!record || record.kind !== 'session') throw new Error('Session share not found');
    const source = await this.loadExpectedSource(sessionKey, input);
    if (source.snapshot.sessionId !== record.sourceSessionId) throw new Error('Session share belongs to a previous session');

    const previous = await this.readManifest(record);
    const includeToolActivities = input.includeToolActivities ?? record.includeToolActivities;
    const attachmentIds = input.attachmentIds ?? previous.attachments.map((attachment) => attachment.id);
    const projection = projectSessionShare(source.snapshot.entries);
    const manifestBase = this.buildManifestBase(shareId, source, projection, {
      includeToolActivities,
      selectedAttachmentIds: attachmentIds,
    });
    const finalDir = this.artifactDir(shareId);
    const stagedDir = `${finalDir}.refresh-${randomUUID()}`;
    const backupDir = `${finalDir}.backup-${randomUUID()}`;
    const built = await this.writeArtifact(stagedDir, manifestBase, projection, attachmentIds);
    let movedOld = false;
    try {
      await rename(finalDir, backupDir);
      movedOld = true;
      await rename(stagedDir, finalDir);
      const updated = this.store.updateSessionSnapshot(shareId, {
        cutoffSeq: built.manifest.source.cutoffSeq,
        artifactSize: built.totalSize,
        messageCount: built.manifest.messages.length,
        attachmentCount: built.manifest.attachments.length,
        includeToolActivities,
        fileName: built.manifest.title,
      });
      if (!updated) throw new Error('Session share not found');
      await rm(backupDir, { recursive: true, force: true }).catch((err) => {
        log.warn({ err, shareId }, 'Failed to remove previous Session share artifact');
      });
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

  list(sessionId: string): SessionShareRecord[] {
    return this.store.getSessionShares(sessionId);
  }

  async readManifest(record: SessionShareRecord): Promise<SessionShareManifest> {
    const path = join(resolveStateDir(), record.artifactRelativePath, 'manifest.json');
    const file = await stat(path);
    if (!file.isFile() || file.size > MAX_MANIFEST_BYTES) throw new Error('Invalid Session share artifact');
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Partial<SessionShareManifest>;
    if (
      manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION
      || manifest.shareId !== record.id
      || typeof manifest.title !== 'string'
      || typeof manifest.snapshotAt !== 'string'
      || !manifest.source
      || manifest.source.sessionId !== record.sourceSessionId
      || manifest.source.cutoffSeq !== record.cutoffSeq
      || !Array.isArray(manifest.messages)
      || !manifest.messages.every(isSessionShareMessage)
      || !Array.isArray(manifest.toolActivities)
      || !manifest.toolActivities.every(isSessionShareToolActivity)
      || !Array.isArray(manifest.attachments)
      || !manifest.attachments.every(isSessionShareAttachment)
    ) throw new Error('Invalid Session share artifact');
    this.validateMessages(manifest.messages);
    this.validateManifestRelations(record, manifest as SessionShareManifest);
    return manifest as SessionShareManifest;
  }

  issueAssetTicket(record: SessionShareRecord): string {
    return issueShareAssetTicket(record, ASSET_TICKET_TTL_MS);
  }

  verifyAssetTicket(record: SessionShareRecord, ticket: string): boolean {
    return verifyShareAssetTicket(record, ticket);
  }

  async resolveAsset(record: SessionShareRecord, attachmentId: string): Promise<{
    path: string;
    attachment: SessionShareManifestAttachment;
  } | null> {
    const manifest = await this.readManifest(record);
    const attachment = manifest.attachments.find((item) => item.id === attachmentId);
    if (!attachment || attachment.artifactFileName !== attachment.id) return null;
    const path = join(resolveStateDir(), record.artifactRelativePath, 'assets', attachment.id);
    if (await checksumFile(path).catch(() => '') !== attachment.checksum) return null;
    return { path, attachment };
  }

  async removeArtifact(shareId: string): Promise<void> {
    await rm(this.artifactDir(shareId), { recursive: true, force: true }).catch((err) => {
      log.warn({ err, shareId }, 'Failed to remove Session share artifact');
    });
  }

  private async loadExpectedSource(
    sessionKey: string,
    expected: Pick<CreateSessionShareInput, 'expectedSessionId' | 'expectedCutoffSeq' | 'expectedMetadataUpdatedAt'>,
  ): Promise<{ metadata: SessionMetadata; snapshot: CompactionSourceSnapshot }> {
    const source = await this.loadSource(sessionKey);
    if (
      source.snapshot.sessionId !== expected.expectedSessionId
      || source.snapshot.lastSeq !== expected.expectedCutoffSeq
      || source.metadata.updatedAt !== expected.expectedMetadataUpdatedAt
    ) {
      throw new SessionShareSnapshotConflictError();
    }
    return source;
  }

  private async loadSource(sessionKey: string): Promise<{ metadata: SessionMetadata; snapshot: CompactionSourceSnapshot }> {
    const [metadata, snapshot] = await Promise.all([
      this.source.getMetadata(sessionKey),
      this.source.getSnapshot(sessionKey),
    ]);
    if (!metadata || !snapshot || !metadata.sessionId || metadata.sessionId !== snapshot.sessionId) {
      throw new Error('Session not found');
    }
    return { metadata, snapshot };
  }

  private buildManifestBase(
    shareId: string,
    source: { metadata: SessionMetadata; snapshot: CompactionSourceSnapshot },
    projection: ReturnType<typeof projectSessionShare>,
    options: { includeToolActivities: boolean; selectedAttachmentIds: string[] },
  ): Omit<SessionShareManifest, 'attachments'> {
    this.validateMessages(projection.messages);
    const selected = new Set(options.selectedAttachmentIds);
    return {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      shareId,
      source: { sessionId: source.snapshot.sessionId, cutoffSeq: source.snapshot.lastSeq },
      title: source.metadata.name?.trim() || 'Shared conversation',
      snapshotAt: new Date().toISOString(),
      messages: projection.messages.map((message) => ({
        ...message,
        attachmentIds: message.attachmentIds.filter((id) => selected.has(id)),
      })),
      toolActivities: options.includeToolActivities ? projection.toolActivities : [],
    };
  }

  private async createArtifact(
    shareId: string,
    manifestBase: Omit<SessionShareManifest, 'attachments'>,
    projection: ReturnType<typeof projectSessionShare>,
    attachmentIds: string[],
  ): Promise<{ manifest: SessionShareManifest; totalSize: number }> {
    const finalDir = this.artifactDir(shareId);
    const stagedDir = `${finalDir}.staged-${randomUUID()}`;
    const built = await this.writeArtifact(stagedDir, manifestBase, projection, attachmentIds);
    try {
      await rename(stagedDir, finalDir);
      return built;
    } catch (error) {
      await rm(stagedDir, { recursive: true, force: true });
      throw error;
    }
  }

  private async writeArtifact(
    targetDir: string,
    manifestBase: Omit<SessionShareManifest, 'attachments'>,
    projection: ReturnType<typeof projectSessionShare>,
    attachmentIds: string[],
  ): Promise<{ manifest: SessionShareManifest; totalSize: number }> {
    const selected = [...new Set(attachmentIds)];
    if (selected.length > MAX_ATTACHMENT_COUNT) throw new Error(`Select at most ${MAX_ATTACHMENT_COUNT} attachments`);
    const candidates = new Map(projection.attachmentCandidates.map((candidate) => [candidate.id, candidate]));
    for (const id of selected) {
      if (!candidates.has(id) || !projection.attachmentUris.has(id)) throw new Error(`Attachment is not part of this session snapshot: ${id}`);
    }

    await mkdir(join(targetDir, 'assets'), { recursive: true });
    const attachments: SessionShareManifestAttachment[] = [];
    let totalAttachmentSize = 0;
    try {
      for (const id of selected) {
        const candidate = candidates.get(id)!;
        const uri = projection.attachmentUris.get(id)!;
        const source = await resolveMediaReference(uri);
        const sourceStat = await stat(source.path);
        if (!sourceStat.isFile()) throw new Error(`Attachment is not a file: ${candidate.fileName}`);
        if (sourceStat.size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment is too large: ${candidate.fileName}`);
        totalAttachmentSize += sourceStat.size;
        if (totalAttachmentSize > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Selected attachments are too large');
        const target = join(targetDir, 'assets', id);
        await copyFile(source.path, target);
        const copied = await stat(target);
        if (!copied.isFile() || copied.size !== sourceStat.size) throw new Error(`Attachment changed while copying: ${candidate.fileName}`);
        attachments.push({
          id,
          messageId: candidate.messageId,
          mimeType: publicMimeType(candidate.mimeType),
          fileName: publicFileName(candidate.fileName),
          size: copied.size,
          artifactFileName: id,
          checksum: await checksumFile(target),
        });
      }

      const manifest: SessionShareManifest = { ...manifestBase, attachments };
      const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      if (bytes.length > MAX_MANIFEST_BYTES) throw new Error('Session share is too large');
      await writeFile(join(targetDir, 'manifest.json'), bytes, { mode: 0o600 });
      return { manifest, totalSize: bytes.length + totalAttachmentSize };
    } catch (error) {
      await rm(targetDir, { recursive: true, force: true });
      throw error;
    }
  }

  private artifactRelativePath(shareId: string): string {
    return join('share-artifacts', shareId);
  }

  private artifactDir(shareId: string): string {
    return join(resolveStateDir(), this.artifactRelativePath(shareId));
  }

  private validateMessages(messages: SessionShareMessage[]): void {
    if (messages.length === 0) throw new Error('Session has no shareable messages');
    if (messages.length > MAX_SHARE_MESSAGES) throw new Error(`Session has more than ${MAX_SHARE_MESSAGES} shareable messages`);
  }

  private validateManifestRelations(record: SessionShareRecord, manifest: SessionShareManifest): void {
    if (manifest.messages.length !== record.messageCount || manifest.attachments.length !== record.attachmentCount) {
      throw new Error('Invalid Session share artifact');
    }
    if (!record.includeToolActivities && manifest.toolActivities.length > 0) throw new Error('Invalid Session share artifact');
    const attachments = new Map(manifest.attachments.map((attachment) => [attachment.id, attachment]));
    if (attachments.size !== manifest.attachments.length) throw new Error('Invalid Session share artifact');
    const messages = new Set(manifest.messages.map((message) => message.id));
    for (const message of manifest.messages) {
      for (const attachmentId of message.attachmentIds) {
        const attachment = attachments.get(attachmentId);
        if (!attachment || attachment.messageId !== message.id) throw new Error('Invalid Session share artifact');
      }
    }
    if (manifest.attachments.some((attachment) => !messages.has(attachment.messageId))) {
      throw new Error('Invalid Session share artifact');
    }
  }
}

function publicFileName(value: string): string {
  return basename(value.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '_').trim().slice(0, 200) || 'attachment';
}

function publicMimeType(value: string): string {
  const normalized = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)
    ? normalized
    : 'application/octet-stream';
}

async function checksumFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function isSessionShareMessage(value: unknown): value is SessionShareMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return typeof message.id === 'string'
    && (message.role === 'user' || message.role === 'assistant')
    && typeof message.markdown === 'string'
    && typeof message.createdAt === 'string'
    && Array.isArray(message.attachmentIds)
    && message.attachmentIds.every((id) => typeof id === 'string');
}

function isSessionShareToolActivity(value: unknown): value is SessionShareToolActivity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const activity = value as Record<string, unknown>;
  return typeof activity.id === 'string'
    && (activity.messageId === undefined || typeof activity.messageId === 'string')
    && typeof activity.toolName === 'string'
    && (activity.status === 'completed' || activity.status === 'failed')
    && typeof activity.createdAt === 'string';
}

function isSessionShareAttachment(value: unknown): value is SessionShareManifestAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attachment = value as Record<string, unknown>;
  return typeof attachment.id === 'string'
    && /^attachment-[a-f0-9]{24}$/.test(attachment.id)
    && typeof attachment.messageId === 'string'
    && typeof attachment.mimeType === 'string'
    && typeof attachment.fileName === 'string'
    && typeof attachment.size === 'number'
    && attachment.artifactFileName === attachment.id
    && typeof attachment.checksum === 'string'
    && /^[a-f0-9]{64}$/.test(attachment.checksum);
}
