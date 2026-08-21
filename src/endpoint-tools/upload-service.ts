import crypto from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EndpointToolContent } from '@xopcai/endpoint-tools-protocol';

const GRANT_TTL_MS = 5 * 60_000;
export const ENDPOINT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_FILES = 8;

interface UploadGrantRecord {
  invocationId: string;
  endpointId: string;
  token: string;
  expiresAt: number;
  maxBytes: number;
  maxFiles: number;
  uploadedFileIds: string[];
}

export interface EndpointUploadedFile {
  fileId: string;
  invocationId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  path: string;
}

export interface EndpointUploadGrant {
  path: string;
  token: string;
  maxBytes: number;
  maxFiles: number;
  expiresAt: number;
}

export class EndpointUploadError extends Error {}

export class EndpointUploadService {
  private readonly grants = new Map<string, UploadGrantRecord>();
  private readonly files = new Map<string, EndpointUploadedFile>();

  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  }

  createGrant(invocationId: string, endpointId: string, now = Date.now()): EndpointUploadGrant {
    const token = crypto.randomUUID();
    const grant: UploadGrantRecord = {
      invocationId,
      endpointId,
      token,
      expiresAt: now + GRANT_TTL_MS,
      maxBytes: ENDPOINT_UPLOAD_MAX_BYTES,
      maxFiles: DEFAULT_MAX_FILES,
      uploadedFileIds: [],
    };
    this.grants.set(invocationId, grant);
    return {
      path: `/api/endpoint-tools/invocations/${encodeURIComponent(invocationId)}/files`,
      token,
      maxBytes: grant.maxBytes,
      maxFiles: grant.maxFiles,
      expiresAt: grant.expiresAt,
    };
  }

  upload(params: {
    invocationId: string;
    endpointId: string;
    token: string;
    name: string;
    mimeType: string;
    bytes: Uint8Array;
    now?: number;
  }): EndpointUploadedFile {
    const grant = this.grants.get(params.invocationId);
    const now = params.now ?? Date.now();
    const expectedToken = grant ? Buffer.from(grant.token) : undefined;
    const receivedToken = Buffer.from(params.token);
    if (!grant || grant.endpointId !== params.endpointId
      || expectedToken?.byteLength !== receivedToken.byteLength
      || !crypto.timingSafeEqual(expectedToken, receivedToken)) {
      throw new EndpointUploadError('Upload grant is invalid');
    }
    if (grant.expiresAt <= now) throw new EndpointUploadError('Upload grant expired');
    if (grant.uploadedFileIds.length >= grant.maxFiles) {
      throw new EndpointUploadError('Upload grant file limit exceeded');
    }
    if (params.bytes.byteLength > grant.maxBytes) {
      throw new EndpointUploadError('Uploaded file is too large');
    }
    if (!params.name || params.name.length > 255 || !params.mimeType || params.mimeType.length > 255) {
      throw new EndpointUploadError('Uploaded file metadata is invalid');
    }

    const fileId = crypto.randomUUID();
    const path = join(this.rootDir, fileId);
    const sha256 = crypto.createHash('sha256').update(params.bytes).digest('hex');
    writeFileSync(path, params.bytes, { flag: 'wx', mode: 0o600 });
    const file: EndpointUploadedFile = {
      fileId,
      invocationId: params.invocationId,
      name: params.name,
      mimeType: params.mimeType,
      size: params.bytes.byteLength,
      sha256,
      path,
    };
    this.files.set(fileId, file);
    grant.uploadedFileIds.push(fileId);
    return file;
  }

  validateAndClose(invocationId: string, content: EndpointToolContent[]): void {
    const grant = this.grants.get(invocationId);
    const referenced = content.filter((item) => item.type === 'file');
    for (const item of referenced) {
      const file = this.files.get(item.fileId);
      if (!file || file.invocationId !== invocationId
        || file.name !== item.name || file.mimeType !== item.mimeType
        || file.size !== item.size || file.sha256 !== item.sha256) {
        throw new EndpointUploadError(`Endpoint file is not valid for invocation: ${item.fileId}`);
      }
    }
    if (grant) {
      for (const fileId of grant.uploadedFileIds) {
        if (!referenced.some((item) => item.fileId === fileId)) this.deleteFile(fileId);
      }
      this.grants.delete(invocationId);
    } else if (referenced.length > 0) {
      throw new EndpointUploadError('Invocation did not have an upload grant');
    }
  }

  abort(invocationId: string): void {
    const grant = this.grants.get(invocationId);
    if (!grant) return;
    for (const fileId of grant.uploadedFileIds) this.deleteFile(fileId);
    this.grants.delete(invocationId);
  }

  getFile(fileId: string): EndpointUploadedFile | undefined {
    return this.files.get(fileId);
  }

  readFile(fileId: string): Uint8Array | undefined {
    const file = this.files.get(fileId);
    return file ? readFileSync(file.path) : undefined;
  }

  private deleteFile(fileId: string): void {
    const file = this.files.get(fileId);
    if (!file) return;
    rmSync(file.path, { force: true });
    this.files.delete(fileId);
  }
}
