import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { stat } from 'node:fs/promises';

import { CredentialResolver } from '../auth/credentials.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { resolveMediaReference } from '../media/media-reference.js';
import type { SessionMetadata } from '../session/types.js';
import type { CompactionSourceSnapshot } from '../storage/sqlite/index.js';
import { projectSessionShare, type SessionShareMessage, type SessionShareToolActivity } from './session-share-projector.js';
import { SessionShareSnapshotConflictError, type SessionShareSource } from './session-share-service.js';
import { resolveConnectedPlatformEndpoint } from '../platform/resolution.js';

const DEFAULT_SHARE_URL = 'https://share.xopc.ai';
const MAX_MESSAGES = 10_000;
const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf', 'text/plain', 'text/markdown',
]);

export interface HostedSessionShareManifest {
  schemaVersion: 1;
  kind: 'session_document';
  title: string;
  snapshotAt: string;
  description?: string;
  messages: SessionShareMessage[];
  toolActivities: SessionShareToolActivity[];
  attachments: Array<{
    id: string;
    messageId: string;
    fileName: string;
    mimeType: string;
    size: number;
    sha256: string;
  }>;
}

export interface HostedSessionShareSnapshot {
  sessionId: string;
  cutoffSeq: number;
  manifest: HostedSessionShareManifest;
  assets: Array<{ id: string; path: string; size: number }>;
}

export interface BuildHostedSessionShareInput {
  expectedSessionId: string;
  expectedCutoffSeq: number;
  expectedMetadataUpdatedAt: string;
  description?: string;
  includeToolActivities?: boolean;
  attachmentIds?: string[];
}

export class HostedSessionShareBuilder {
  constructor(private readonly source: SessionShareSource) {}

  async build(sessionKey: string, input: BuildHostedSessionShareInput): Promise<HostedSessionShareSnapshot> {
    const source = await this.loadExpectedSource(sessionKey, input);
    const projection = projectSessionShare(source.snapshot.entries);
    if (projection.messages.length === 0) throw new Error('Session has no shareable messages');
    if (projection.messages.length > MAX_MESSAGES) throw new Error(`Session has more than ${MAX_MESSAGES} shareable messages`);

    const selected = [...new Set(input.attachmentIds ?? [])];
    if (selected.length > MAX_ATTACHMENTS) throw new Error(`Select at most ${MAX_ATTACHMENTS} attachments`);
    const candidates = new Map(projection.attachmentCandidates.map((candidate) => [candidate.id, candidate]));
    const attachments: HostedSessionShareManifest['attachments'] = [];
    const assets: HostedSessionShareSnapshot['assets'] = [];
    let totalSize = 0;
    for (const id of selected) {
      const candidate = candidates.get(id);
      const uri = projection.attachmentUris.get(id);
      if (!candidate || !uri) throw new Error(`Attachment is not part of this session snapshot: ${id}`);
      const mimeType = normalizeMimeType(candidate.mimeType);
      if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error(`Attachment type is not supported for hosted sharing: ${candidate.fileName}`);
      const resolved = await resolveMediaReference(uri);
      const sourceStat = await stat(resolved.path);
      if (!sourceStat.isFile()) throw new Error(`Attachment is not a file: ${candidate.fileName}`);
      if (sourceStat.size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment is too large: ${candidate.fileName}`);
      totalSize += sourceStat.size;
      if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Selected attachments are too large');
      attachments.push({
        id,
        messageId: candidate.messageId,
        fileName: publicFileName(candidate.fileName),
        mimeType,
        size: sourceStat.size,
        sha256: await checksumFile(resolved.path),
      });
      assets.push({ id, path: resolved.path, size: sourceStat.size });
    }

    const selectedIds = new Set(selected);
    return {
      sessionId: source.snapshot.sessionId,
      cutoffSeq: source.snapshot.lastSeq,
      manifest: {
        schemaVersion: 1,
        kind: 'session_document',
        title: (source.metadata.name?.trim() || 'Shared conversation').slice(0, 200),
        snapshotAt: new Date().toISOString(),
        ...(input.description?.trim() ? { description: input.description.trim().slice(0, 1_000) } : {}),
        messages: projection.messages.map((message) => ({
          ...message,
          attachmentIds: message.attachmentIds.filter((id) => selectedIds.has(id)),
        })),
        toolActivities: input.includeToolActivities ? projection.toolActivities : [],
        attachments,
      },
      assets,
    };
  }

  private async loadExpectedSource(
    sessionKey: string,
    expected: Pick<BuildHostedSessionShareInput, 'expectedSessionId' | 'expectedCutoffSeq' | 'expectedMetadataUpdatedAt'>,
  ): Promise<{ metadata: SessionMetadata; snapshot: CompactionSourceSnapshot }> {
    const [metadata, snapshot] = await Promise.all([
      this.source.getMetadata(sessionKey),
      this.source.getSnapshot(sessionKey),
    ]);
    if (!metadata || !snapshot || !metadata.sessionId || metadata.sessionId !== snapshot.sessionId) {
      throw new Error('Session not found');
    }
    if (
      snapshot.sessionId !== expected.expectedSessionId
      || snapshot.lastSeq !== expected.expectedCutoffSeq
      || metadata.updatedAt !== expected.expectedMetadataUpdatedAt
    ) {
      throw new SessionShareSnapshotConflictError();
    }
    return { metadata, snapshot };
  }
}

export interface HostedShareResult {
  id: string;
  shareUrl: string;
  expiresAt: string;
  maxViews: number | null;
  viewCount: number;
  snapshotRevision: number;
}

export type HostedPublicationKind = 'session_document' | 'note_document' | 'static_site';

export interface HostedPublicationSnapshot {
  kind: HostedPublicationKind;
  manifest: unknown;
  assets: Array<{ id: string; path: string; size: number }>;
}

type DraftResponse = {
  shareId: string;
  uploadId: string;
  targetRevision: number;
  publicUrl?: string;
  assetUploads: Array<{ assetId: string; uploadUrl: string }>;
};

export type HostedPublicationSummary = {
  id: string;
  title: string;
  description: string | null;
  status: 'staging' | 'active' | 'revoked';
  revision: number | null;
  expiresAt: string;
  maxViews: number | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  kind: HostedPublicationKind;
  deliveryMode: 'hosted_snapshot';
  owner: { type: 'user' | 'workspace'; id: string };
  workspaceId: string;
  createdByPrincipalId: string;
};

type OwnerShare = HostedPublicationSummary;

export interface HostedPublicationCapabilities {
  protocolVersion: string;
  kinds: string[];
  deliveryModes: string[];
  accessModes: string[];
  upload: { direct: boolean; multipart: boolean; resumable: boolean; streaming: boolean };
  security?: { contentScanning: boolean; quarantineBeforeActivation: boolean };
  lifecycle: { revisions: boolean; revoke: boolean; asynchronousDeletion: boolean };
  publishing: { allowed: boolean; managedBy: 'platform_admin' };
}

type NodeRequestInit = RequestInit & { duplex?: 'half' };

export class HostedPublicationPublisher {
  private readonly baseUrl: string;

  constructor(
    baseUrl = process.env.XOPC_SHARE_URL ?? resolveConnectedPlatformEndpoint('shareApi') ?? DEFAULT_SHARE_URL,
    private readonly credentials = new CredentialResolver(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async create(snapshot: HostedSessionShareSnapshot, lifecycle: { ttlMs: number; maxViews: number | null }): Promise<HostedShareResult> {
    return this.createPublication({ kind: 'session_document', manifest: snapshot.manifest, assets: snapshot.assets }, lifecycle);
  }

  async createPublication(snapshot: HostedPublicationSnapshot, lifecycle: { ttlMs: number; maxViews: number | null }): Promise<HostedShareResult> {
    const publicToken = randomBytes(32).toString('base64url');
    const draft = await this.request<DraftResponse>('/api/v1/publications', {
      method: 'POST',
      headers: { 'Idempotency-Key': `xopc-${randomUUID()}` },
      body: JSON.stringify({ kind: snapshot.kind, publicToken, manifest: snapshot.manifest, ...lifecycle }),
    });
    await this.uploadAssets(draft, snapshot.assets);
    const finalized = await this.request<{ item: OwnerShare }>(
      `/api/v1/publications/${encodeURIComponent(draft.shareId)}/uploads/${encodeURIComponent(draft.uploadId)}/finalize`,
      { method: 'POST' },
    );
    if (!draft.publicUrl) throw new Error('Hosted Share did not return a public URL');
    return toResult(finalized.item, draft.publicUrl);
  }

  async refresh(shareId: string, expectedRevision: number, publicUrl: string, snapshot: HostedSessionShareSnapshot): Promise<HostedShareResult> {
    return this.refreshPublication(
      shareId,
      expectedRevision,
      publicUrl,
      { kind: 'session_document', manifest: snapshot.manifest, assets: snapshot.assets },
    );
  }

  async refreshPublication(
    shareId: string,
    expectedRevision: number,
    publicUrl: string,
    snapshot: HostedPublicationSnapshot,
  ): Promise<HostedShareResult> {
    const draft = await this.request<DraftResponse>(`/api/v1/publications/${encodeURIComponent(shareId)}/revisions`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `xopc-${randomUUID()}` },
      body: JSON.stringify({ expectedRevision, manifest: snapshot.manifest }),
    });
    await this.uploadAssets(draft, snapshot.assets);
    const finalized = await this.request<{ item: OwnerShare }>(
      `/api/v1/publications/${encodeURIComponent(shareId)}/uploads/${encodeURIComponent(draft.uploadId)}/finalize`,
      { method: 'POST' },
    );
    return toResult(finalized.item, publicUrl);
  }

  async listPublications(): Promise<HostedPublicationSummary[]> {
    return (await this.request<{ items: HostedPublicationSummary[] }>('/api/v1/publications')).items;
  }

  async capabilities(): Promise<HostedPublicationCapabilities> {
    return this.request<HostedPublicationCapabilities>('/api/v1/publications/capabilities');
  }

  async revoke(shareId: string): Promise<void> {
    await this.revokePublication(shareId);
  }

  async revokePublication(shareId: string): Promise<void> {
    await this.request(`/api/v1/publications/${encodeURIComponent(shareId)}`, { method: 'DELETE' });
  }

  async listRevisions(shareId: string): Promise<Array<{ revision: number; createdAt: string; current: boolean }>> {
    return (await this.request<{ items: Array<{ revision: number; createdAt: string; current: boolean }> }>(
      `/api/v1/publications/${encodeURIComponent(shareId)}/revisions`,
    )).items;
  }

  async rollbackPublication(shareId: string, expectedRevision: number, targetRevision: number): Promise<HostedPublicationSummary> {
    return (await this.request<{ item: HostedPublicationSummary }>(`/api/v1/publications/${encodeURIComponent(shareId)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision, targetRevision }),
    })).item;
  }

  private async uploadAssets(draft: DraftResponse, assets: HostedPublicationSnapshot['assets']): Promise<void> {
    const uploads = new Map(draft.assetUploads.map((upload) => [upload.assetId, upload.uploadUrl]));
    for (const asset of assets) {
      const uploadUrl = uploads.get(asset.id);
      if (!uploadUrl) throw new Error(`Hosted Share did not accept attachment: ${asset.id}`);
      const current = await stat(asset.path);
      if (!current.isFile() || current.size !== asset.size) throw new Error(`Attachment changed during upload: ${asset.id}`);
      await this.request(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Length': String(asset.size), 'Content-Type': 'application/octet-stream' },
        body: createReadStream(asset.path) as unknown as RequestInit['body'],
        duplex: 'half',
      });
    }
  }

  private async request<T = { ok: true }>(path: string, init: NodeRequestInit = {}): Promise<T> {
    const token = await this.credentials.loadOAuthToken('xopc-share');
    if (!token) throw new HostedShareAuthorizationError();
    const url = new URL(path, `${this.baseUrl}/`);
    if (url.origin !== new URL(this.baseUrl).origin) throw new Error('Hosted Share returned an invalid upload URL');
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body && !(init.headers as Record<string, string> | undefined)?.['Content-Type'] ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
        Authorization: `Bearer ${token.access}`,
      },
      signal: init.signal ?? AbortSignal.timeout(120_000),
    });
    const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    if (response.status === 401) throw new HostedShareAuthorizationError();
    if (!response.ok) {
      throw new HostedShareRemoteError(
        body.error?.message || `Hosted Share request failed (${response.status})`,
        response.status,
        body.error?.code,
      );
    }
    return body as T;
  }
}

export class HostedShareAuthorizationError extends Error {
  constructor() {
    super('Connect XOPC Hosted Share before publishing');
    this.name = 'HostedShareAuthorizationError';
  }
}

export class HostedShareRemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HostedShareRemoteError';
  }
}

export type HostedPublicationSource = { kind: 'session' | 'note' | 'static_site'; id: string; version: string };

export interface HostedShareBinding extends HostedShareResult {
  kind: HostedPublicationKind;
  source: HostedPublicationSource;
  revisionSources: Record<string, HostedPublicationSource>;
  workspaceContext?: { workspaceRoot?: string; sessionKey?: string; agentId?: string };
  sessionId?: string;
  cutoffSeq?: number;
  title: string;
  description: string | null;
  messageCount?: number;
  attachmentCount: number;
  includeToolActivities?: boolean;
  attachmentIds: string[];
  createdAt: string;
  updatedAt: string;
  revoked: boolean;
}

export class HostedShareBindingStore {
  private readonly state = new DurableState<HostedShareBinding>('hosted-share-bindings');

  async list(sessionId: string): Promise<HostedShareBinding[]> {
    return this.state.values().filter(item => item.sessionId === sessionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listBySource(kind: HostedPublicationSource['kind'], id: string): Promise<HostedShareBinding[]> {
    return this.state.values()
      .filter(item => item.source.kind === kind && item.source.id === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listAll(): Promise<HostedShareBinding[]> {
    return this.state.values().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async upsert(binding: HostedShareBinding): Promise<void> { this.state.set(binding.id, binding); }

  async markRevoked(id: string): Promise<void> {
    const binding = this.state.get(id);
    if (binding) this.state.set(id, { ...binding, revoked: true, updatedAt: new Date().toISOString() });
  }

  async reconcile(remote: OwnerShare[]): Promise<void> {
    const byId = new Map(remote.map(item => [item.id, item]));
    requireXopcDatabase();
    runSqliteWriteTransaction(() => {
      for (const binding of this.state.values()) {
        const item = byId.get(binding.id);
        if (item) this.state.set(binding.id, {
          ...binding, expiresAt: item.expiresAt, maxViews: item.maxViews, viewCount: item.viewCount,
          snapshotRevision: item.revision ?? binding.snapshotRevision, title: item.title,
          description: item.description, updatedAt: item.updatedAt, revoked: item.status === 'revoked',
        });
      }
    });
  }
}

function toResult(item: OwnerShare, shareUrl: string): HostedShareResult {
  if (!item.revision) throw new Error('Hosted Share revision was not activated');
  return {
    id: item.id,
    shareUrl,
    expiresAt: item.expiresAt,
    maxViews: item.maxViews,
    viewCount: item.viewCount,
    snapshotRevision: item.revision,
  };
}

function normalizeMimeType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

function publicFileName(value: string): string {
  return basename(value.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '_').trim().slice(0, 200) || 'attachment';
}

async function checksumFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
