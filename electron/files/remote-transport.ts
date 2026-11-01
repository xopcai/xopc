import { FileResourceSchema, type FileResource } from '@xopcai/gateway-contract';
import { z } from 'zod';

import type { ShellUpstream } from '../shell/upstream.js';
import type { RemoteFileTransport } from './remote-snapshots.js';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,160}\.[A-Za-z0-9_-]{1,4000}$/);
const unwrap = (value: unknown) => value && typeof value === 'object' && 'payload' in value ? value.payload : value;
const editable = (resource: FileResource) => resource.kind === 'file' && resource.size <= 32768 && resource.capabilities.includes('edit')
  && /^(?:text\/[^;]+|application\/(?:json|xml|javascript|x-yaml))(?:;|$)/i.test(resource.mimeType);

/** Owner file API transport, confined to the already pinned Shell origin. No local path API is used. */
export class RemoteFileUpstream implements RemoteFileTransport {
  constructor(private readonly upstream: ShellUpstream) {}
  async browse(conversation: unknown, signal = AbortSignal.timeout(10000), directoryId?: unknown) {
    const id = z.uuid().parse(conversation);
    await this.upstream.verifyPinnedIdentity(signal);
    const context = z.object({ space: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/) }) }).parse(unwrap(await this.upstream.json(`/api/files/contexts/session/${id}`, signal)));
    let path = '';
    if (directoryId !== undefined) {
      const directory = idSchema.parse(directoryId);
      const resource = z.object({ resource: FileResourceSchema }).parse(unwrap(await this.upstream.json(`/api/files/${directory}`, signal))).resource;
      if (resource.id !== directory || resource.spaceId !== context.space.id || resource.kind !== 'directory'
        || !resource.relativePath || resource.relativePath.length > 4096 || resource.relativePath.includes('\\') || resource.relativePath.includes('\0')
        || resource.relativePath.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('REMOTE_FILE_DIRECTORY_INVALID');
      path = resource.relativePath;
    }
    const response = z.object({ items: z.array(FileResourceSchema).max(1000) }).parse(unwrap(await this.upstream.json(`/api/files/spaces/${context.space.id}/children${path ? '?path=' + encodeURIComponent(path) : ''}`, signal)));
    if (response.items.some(resource => resource.spaceId !== context.space.id || resource.parentPath !== path)) throw new Error('REMOTE_FILE_DIRECTORY_CHANGED');
    return response.items.filter(resource => resource.kind === 'directory' || editable(resource)).slice(0, 100)
      .map(resource => ({ id: resource.id, name: resource.name.slice(0, 255), revision: resource.revision, size: resource.size, kind: resource.kind }));
  }
  async read(input: string, signal: AbortSignal) {
    const id = idSchema.parse(input); await this.upstream.verifyPinnedIdentity(signal);
    const resource = z.object({ resource: FileResourceSchema }).parse(unwrap(await this.upstream.json(`/api/files/${id}`, signal))).resource;
    if (resource.id !== id || !editable(resource)) throw new Error('REMOTE_FILE_NOT_EDITABLE_TEXT');
    const response = await this.request(`/api/files/${id}/content`, 'GET', signal, undefined, 32768);
    if (response.status !== 200) throw new Error('REMOTE_FILE_READ_FAILED');
    const after = z.object({ resource: FileResourceSchema }).parse(unwrap(await this.upstream.json(`/api/files/${id}`, signal))).resource;
    if (after.id !== id || after.revision !== resource.revision) throw new Error('REMOTE_FILE_SNAPSHOT_CHANGED');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(response.bytes); }
    catch { throw new Error('REMOTE_FILE_NOT_UTF8'); }
    return { resource, text, etag: response.etag ?? '' };
  }
  async put(input: string, text: string, revision: string, signal: AbortSignal): ReturnType<RemoteFileTransport['put']> {
    const id = idSchema.parse(input);
    if (Buffer.byteLength(text) > 32768 || typeof revision !== 'string' || !revision || revision.length > 4096) throw new Error('REMOTE_FILE_ARGUMENT_INVALID');
    await this.upstream.verifyPinnedIdentity(signal);
    const response = await this.request(`/api/files/${id}/content`, 'PUT', signal, JSON.stringify({ content: text, revision }), 65536);
    if (response.status === 409) return { status: 'conflict' };
    if (response.status !== 200) throw new Error('REMOTE_FILE_UPLOAD_FAILED');
    let value: unknown;
    try { value = JSON.parse(response.bytes.toString('utf8')); } catch { throw new Error('REMOTE_FILE_RESPONSE_INVALID'); }
    const resource = z.object({ resource: FileResourceSchema }).parse(unwrap(value)).resource;
    return { status: 'saved', resource };
  }
  private request(path: string, method: string, signal: AbortSignal, body: string | undefined, maximum: number) {
    return new Promise<{ status: number; bytes: Buffer; etag?: string }>((resolve, reject) => {
      const request = this.upstream.request(path, method, body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) }, signal);
      request.on('error', () => reject(new Error('REMOTE_FILE_NETWORK_FAILED')));
      request.on('response', response => {
        if (method === 'PUT' && response.statusCode === 409) { response.destroy(); resolve({ status: 409, bytes: Buffer.alloc(0) }); return; }
        if (response.statusCode !== 200 || Number(response.headers['content-length'] ?? 0) > maximum) { response.destroy(); reject(new Error('REMOTE_FILE_RESPONSE_REJECTED')); return; }
        let size = 0; const chunks: Buffer[] = [];
        response.on('data', chunk => { size += chunk.length; if (size > maximum) response.destroy(new Error('REMOTE_FILE_RESPONSE_LIMIT')); else chunks.push(chunk); });
        response.on('error', () => reject(new Error('REMOTE_FILE_RESPONSE_FAILED')));
        response.on('end', () => resolve({ status: response.statusCode!, bytes: Buffer.concat(chunks), ...(typeof response.headers.etag === 'string' ? { etag: response.headers.etag } : {}) }));
      });
      request.end(body);
    });
  }
}
