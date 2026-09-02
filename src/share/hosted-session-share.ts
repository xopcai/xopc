import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { mkdir, readFile, stat } from 'node:fs/promises';

import { CredentialResolver } from '../auth/credentials.js';
import { resolveStateDir } from '../config/paths.js';
import { writeTextAtomic } from '../infra/write-file-atomic.js';
import { resolveMediaReference } from '../media/media-reference.js';
import type { SessionMetadata } from '../session/types.js';
import type { CompactionSourceSnapshot } from '../storage/sqlite/index.js';
import { projectSessionShare, type SessionShareMessage, type SessionShareToolActivity } from './session-share-projector.js';
import { SessionShareSnapshotConflictError, type SessionShareSource } from './session-share-service.js';

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

type DraftResponse = {
  shareId: string;
  uploadId: string;
  targetRevision: number;
  publicUrl?: string;
  assetUploads: Array<{ assetId: string; uploadUrl: string }>;
};

type OwnerShare = {
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
};

export class HostedSessionSharePublisher {
  private readonly baseUrl: string;

  constructor(
    baseUrl = process.env.XOPC_SHARE_URL ?? DEFAULT_SHARE_URL,
    private readonly credentials = new CredentialResolver(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async create(snapshot: HostedSessionShareSnapshot, lifecycle: { ttlMs: number; maxViews: number | null }): Promise<HostedShareResult> {
    const publicToken = randomBytes(32).toString('base64url');
    const draft = await this.request<DraftResponse>('/api/v1/session-shares', {
      method: 'POST',
      headers: { 'Idempotency-Key': `xopc-${randomUUID()}` },
      body: JSON.stringify({ publicToken, manifest: snapshot.manifest, ...lifecycle }),
    });
    await this.uploadAssets(draft, snapshot.assets);
    const finalized = await this.request<{ item: OwnerShare }>(
      `/api/v1/session-shares/${encodeURIComponent(draft.shareId)}/uploads/${encodeURIComponent(draft.uploadId)}/finalize`,
      { method: 'POST' },
    );
    if (!draft.publicUrl) throw new Error('Hosted Share did not return a public URL');
    return toResult(finalized.item, draft.publicUrl);
  }

  async refresh(shareId: string, expectedRevision: number, publicUrl: string, snapshot: HostedSessionShareSnapshot): Promise<HostedShareResult> {
    const draft = await this.request<DraftResponse>(`/api/v1/session-shares/${encodeURIComponent(shareId)}/revisions`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `xopc-${randomUUID()}` },
      body: JSON.stringify({ expectedRevision, manifest: snapshot.manifest }),
    });
    await this.uploadAssets(draft, snapshot.assets);
    const finalized = await this.request<{ item: OwnerShare }>(
      `/api/v1/session-shares/${encodeURIComponent(shareId)}/uploads/${encodeURIComponent(draft.uploadId)}/finalize`,
      { method: 'POST' },
    );
    return toResult(finalized.item, publicUrl);
  }

  async list(): Promise<OwnerShare[]> {
    return (await this.request<{ items: OwnerShare[] }>('/api/v1/session-shares')).items;
  }

  async revoke(shareId: string): Promise<void> {
    await this.request(`/api/v1/session-shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' });
  }

  private async uploadAssets(draft: DraftResponse, assets: HostedSessionShareSnapshot['assets']): Promise<void> {
    const uploads = new Map(draft.assetUploads.map((upload) => [upload.assetId, upload.uploadUrl]));
    for (const asset of assets) {
      const uploadUrl = uploads.get(asset.id);
      if (!uploadUrl) throw new Error(`Hosted Share did not accept attachment: ${asset.id}`);
      const bytes = await readFile(asset.path);
      if (bytes.byteLength !== asset.size) throw new Error(`Attachment changed during upload: ${asset.id}`);
      await this.request(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Length': String(bytes.byteLength), 'Content-Type': 'application/octet-stream' },
        body: bytes,
      });
    }
  }

  private async request<T = { ok: true }>(path: string, init: RequestInit = {}): Promise<T> {
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
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    if (response.status === 401) throw new HostedShareAuthorizationError();
    if (!response.ok) throw new Error(body.error?.message || `Hosted Share request failed (${response.status})`);
    return body as T;
  }
}

export class HostedShareAuthorizationError extends Error {
  constructor() {
    super('Connect XOPC Hosted Share before publishing');
    this.name = 'HostedShareAuthorizationError';
  }
}

export interface HostedShareBinding extends HostedShareResult {
  sessionId: string;
  cutoffSeq: number;
  title: string;
  description: string | null;
  messageCount: number;
  attachmentCount: number;
  includeToolActivities: boolean;
  attachmentIds: string[];
  createdAt: string;
  updatedAt: string;
  revoked: boolean;
}

type BindingFile = { version: 1; items: HostedShareBinding[] };

export class HostedShareBindingStore {
  private readonly path = join(resolveStateDir(), 'hosted-share-bindings.json');
  private pending: Promise<unknown> = Promise.resolve();

  async list(sessionId: string): Promise<HostedShareBinding[]> {
    const file = await this.read();
    return file.items.filter((item) => item.sessionId === sessionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async upsert(binding: HostedShareBinding): Promise<void> {
    await this.mutate((file) => {
      const index = file.items.findIndex((item) => item.id === binding.id);
      if (index === -1) file.items.push(binding);
      else file.items[index] = binding;
    });
  }

  async reconcile(remote: OwnerShare[]): Promise<void> {
    const byId = new Map(remote.map((item) => [item.id, item]));
    await this.mutate((file) => {
      file.items = file.items.map((binding) => {
        const item = byId.get(binding.id);
        return item ? {
          ...binding,
          expiresAt: item.expiresAt,
          maxViews: item.maxViews,
          viewCount: item.viewCount,
          snapshotRevision: item.revision ?? binding.snapshotRevision,
          title: item.title,
          description: item.description,
          updatedAt: item.updatedAt,
          revoked: item.status === 'revoked',
        } : binding;
      });
    });
  }

  private async mutate(update: (file: BindingFile) => void): Promise<void> {
    const operation = this.pending.then(async () => {
      const file = await this.read();
      update(file);
      await mkdir(dirname(this.path), { recursive: true });
      await writeTextAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }

  private async read(): Promise<BindingFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<BindingFile>;
      return parsed.version === 1 && Array.isArray(parsed.items) ? { version: 1, items: parsed.items as HostedShareBinding[] } : { version: 1, items: [] };
    } catch {
      return { version: 1, items: [] };
    }
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
