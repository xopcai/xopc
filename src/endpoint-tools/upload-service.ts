import crypto from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { COMPUTER_FRAME_MAX_BYTES, COMPUTER_FRAME_MAX_PIXELS } from '@xopcai/computer-control-contract';

import {
  ENDPOINT_MAX_FILE_BYTES,
  type EndpointToolContent,
} from '@xopcai/endpoint-tools-protocol';

const GRANT_TTL_MS = 5 * 60_000;
export const ENDPOINT_UPLOAD_MAX_BYTES = ENDPOINT_MAX_FILE_BYTES;
const DEFAULT_MAX_FILES = 8;

interface UploadGrantRecord {
  profile: 'durable' | 'computer-frame';
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

export class EndpointUploadError extends Error {
  constructor(message: string, readonly code: 'INVALID_UPLOAD_GRANT' | 'UPLOAD_TOO_LARGE' | 'INVALID_COMPUTER_FRAME' | 'UPLOAD_BUSY' = 'INVALID_UPLOAD_GRANT') {
    super(message);
  }
}

export class EndpointUploadService {
  private readonly grants = new Map<string, UploadGrantRecord>();
  private readonly files = new Map<string, EndpointUploadedFile>();
  private readonly frames = new Map<string, { bytes: Buffer; expiresAt: number; endpointId: string }>();
  private readonly pruneTimer: ReturnType<typeof setInterval>;
  private readonly validatingFrames = new Set<string>();

  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true, mode: 0o700 });
    this.pruneTimer = setInterval(() => this.pruneFrames(Date.now()), 1000);
    this.pruneTimer.unref();
  }

  createGrant(invocationId: string, endpointId: string, now = Date.now(), profile: 'durable' | 'computer-frame' = 'durable'): EndpointUploadGrant {
    const token = crypto.randomUUID();
    const grant: UploadGrantRecord = {
      profile,
      invocationId,
      endpointId,
      token,
      expiresAt: now + GRANT_TTL_MS,
      maxBytes: profile === 'computer-frame' ? COMPUTER_FRAME_MAX_BYTES : ENDPOINT_UPLOAD_MAX_BYTES,
      maxFiles: profile === 'computer-frame' ? 1 : DEFAULT_MAX_FILES,
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
    validatedFrame?: boolean;
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
    if (grant.profile === 'computer-frame' && !params.validatedFrame) throw new EndpointUploadError('Computer frame requires image validation');
    if (grant.uploadedFileIds.length >= grant.maxFiles) {
      throw new EndpointUploadError('Upload grant file limit exceeded');
    }
    if (params.bytes.byteLength > grant.maxBytes) {
      throw new EndpointUploadError('Uploaded file is too large', 'UPLOAD_TOO_LARGE');
    }
    if (!params.name || params.name.length > 255 || !params.mimeType || params.mimeType.length > 255) {
      throw new EndpointUploadError('Uploaded file metadata is invalid');
    }

    const fileId = crypto.randomUUID();
    const path = join(this.rootDir, fileId);
    const sha256 = crypto.createHash('sha256').update(params.bytes).digest('hex');
    if (grant.profile === 'durable') writeFileSync(path, params.bytes, { flag: 'wx', mode: 0o600 });
    else {
      this.pruneFrames(now);
      const frames = [...this.frames.values()];
      if (frames.reduce((n, f) => n + f.bytes.length, params.bytes.length) > 128 * 1024 * 1024
        || frames.filter((f) => f.endpointId === grant.endpointId).reduce((n, f) => n + f.bytes.length, params.bytes.length) > 32 * 1024 * 1024) {
        throw new EndpointUploadError('Computer frame memory budget exceeded');
      }
      this.frames.set(fileId, { bytes: Buffer.from(params.bytes), expiresAt: now + 120_000, endpointId: grant.endpointId });
    }
    const file: EndpointUploadedFile = {
      fileId,
      invocationId: params.invocationId,
      name: params.name,
      mimeType: params.mimeType,
      size: params.bytes.byteLength,
      sha256,
      path: grant.profile === 'computer-frame' ? '' : path,
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
    const file = this.files.get(fileId);
    return file?.path ? file : undefined;
  }

  readFile(fileId: string): Uint8Array | undefined {
    const file = this.files.get(fileId);
    return file?.path ? readFileSync(file.path) : undefined;
  }

  getGrantLimits(invocationId: string, endpointId: string, token: string) {
    const grant = this.grants.get(invocationId);
    const actual = Buffer.from(token), expected = Buffer.from(grant?.token ?? '');
    if (!grant || grant.endpointId !== endpointId || actual.length !== expected.length
      || !crypto.timingSafeEqual(actual, expected) || grant.expiresAt <= Date.now()) throw new EndpointUploadError('Upload grant is invalid or expired');
    if (grant.uploadedFileIds.length >= grant.maxFiles) throw new EndpointUploadError('Upload grant file limit exceeded');
    return { maxBytes: grant.maxBytes, profile: grant.profile };
  }

  async uploadValidated(params: Parameters<EndpointUploadService['upload']>[0]): Promise<EndpointUploadedFile> {
    const grant = this.getGrantLimits(params.invocationId, params.endpointId, params.token);
    if (params.bytes.length > grant.maxBytes) throw new EndpointUploadError('Uploaded file is too large', 'UPLOAD_TOO_LARGE');
    if (grant.profile === 'computer-frame') {
      if (this.validatingFrames.has(params.invocationId) || this.validatingFrames.size >= 2) {
        throw new EndpointUploadError('Computer frame validation is busy', 'UPLOAD_BUSY');
      }
      this.validatingFrames.add(params.invocationId);
      try {
        const metadata = await sharp(params.bytes, { limitInputPixels: COMPUTER_FRAME_MAX_PIXELS }).metadata();
        const format = params.mimeType === 'image/png' ? 'png' : params.mimeType === 'image/jpeg' ? 'jpeg' : undefined;
        if (!format || metadata.format !== format || !metadata.width || !metadata.height
          || metadata.width * metadata.height > COMPUTER_FRAME_MAX_PIXELS || (metadata.pages ?? 1) !== 1) throw new EndpointUploadError('Invalid computer frame image', 'INVALID_COMPUTER_FRAME');
        // Force a bounded decode; valid headers alone do not prove a valid image payload.
        const decoded = await sharp(params.bytes, { limitInputPixels: COMPUTER_FRAME_MAX_PIXELS, failOn: 'warning' }).raw().toBuffer();
        decoded.fill(0);
      } catch (error) {
        if (error instanceof EndpointUploadError) throw error;
        throw new EndpointUploadError('Computer frame could not be decoded', 'INVALID_COMPUTER_FRAME');
      } finally { this.validatingFrames.delete(params.invocationId); }
      // Revalidate after async decode; cancellation may have revoked the grant.
      return this.upload({ ...params, validatedFrame: true });
    }
    return this.upload(params);
  }

  /** Single-consumer handoff, inaccessible through generic attachment routes. */
  takeComputerFrame(fileId: string, invocationId: string): Uint8Array | undefined {
    this.pruneFrames(Date.now());
    if (this.files.get(fileId)?.invocationId !== invocationId) return undefined;
    const frame = this.frames.get(fileId);
    if (!frame) return undefined;
    const bytes = Buffer.from(frame.bytes);
    this.deleteFile(fileId);
    return bytes;
  }

  private pruneFrames(now: number): void {
    for (const [id, frame] of this.frames) if (frame.expiresAt <= now) this.deleteFile(id);
  }

  close(): void {
    clearInterval(this.pruneTimer);
    for (const id of this.frames.keys()) this.deleteFile(id);
    this.grants.clear();
  }

  private deleteFile(fileId: string): void {
    const file = this.files.get(fileId);
    if (!file) return;
    if (file.path) rmSync(file.path, { force: true });
    this.frames.get(fileId)?.bytes.fill(0);
    this.frames.delete(fileId);
    this.files.delete(fileId);
  }
}
