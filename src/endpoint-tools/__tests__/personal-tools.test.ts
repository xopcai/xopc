import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PERSONAL_TOOL_NAMES, personalDescriptor } from '@xopcai/endpoint-tools-protocol';

import { EndpointRegistry } from '../registry.js';
import { EndpointInvocationService } from '../invocation-service.js';
import { EndpointUploadService } from '../upload-service.js';
import { EndpointToolPolicy } from '../policy.js';

function fixture(name: typeof PERSONAL_TOOL_NAMES[number]) {
  const sent: string[] = [];
  const registry = new EndpointRegistry();
  registry.register({ principalId: 'phone-owner', endpointId: 'phone', connectionInstanceId: randomUUID(),
    displayName: 'Phone', kind: 'mobile', platform: 'android', appVersion: '1', availability: 'foreground', nonce: randomUUID(),
    signedAt: Date.now(), signature: 'fixture-signature', tools: [personalDescriptor(name)] }, 'connection',
  { readyState: 1, send: value => sent.push(value), close: () => {} });
  const service = new EndpointInvocationService(registry);
  const invoke = (args: Record<string, unknown>, signal?: AbortSignal) => service.invoke({ endpointId: 'phone',
    toolName: name, toolCallId: randomUUID(), descriptorRevision: registry.getTool('phone', name)!.revision, arguments: args, signal });
  const result = (value: unknown) => {
    const invocationId = JSON.parse(sent[0]).payload.invocationId;
    service.handleMessage('phone', { protocolVersion: 2, messageId: randomUUID(), type: 'tool.received', sentAt: Date.now(), payload: { invocationId } });
    service.handleMessage('phone', { protocolVersion: 2, messageId: randomUUID(), type: 'tool.result', sentAt: Date.now(), payload: { invocationId, content: [{ type: 'json', value }] } });
  };
  return { registry, service, sent, invoke, result };
}

describe('Personal device tools', () => {
  it('accepts the fixed native descriptors and rejects expanded calendar contracts', () => {
    const policy = new EndpointToolPolicy();
    for (const name of PERSONAL_TOOL_NAMES) expect(() => policy.validateDescriptor('mobile', personalDescriptor(name))).not.toThrow();
    const descriptor = personalDescriptor('mobile.calendar.query_events');
    expect(() => policy.validateDescriptor('mobile', { ...descriptor, confirmation: 'never' })).toThrow();
    expect(() => policy.validateDescriptor('mobile', { ...descriptor, inputSchema: { type: 'object' } })).toThrow();
  });
  it('rejects unbounded, reversed, extra-field and noninteger calendar requests before dispatch', async () => {
    const f = fixture('mobile.calendar.query_events');
    for (const args of [{ startAt: 1, endAt: 1 }, { startAt: 10, endAt: 1 },
      { startAt: 1, endAt: 7 * 86400000 + 2 }, { startAt: 1.1, endAt: 3 }, { startAt: 1, endAt: 3, descriptions: true }]) {
      await expect(f.invoke(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    }
    expect(f.sent).toEqual([]); f.service.close();
  });
  it('rejects titles in a busy-only result and calendar scope changes', async () => {
    for (const value of [{ startAt: 1, endAt: 3, events: [{ startAt: 1, endAt: 2, busy: true, allDay: false, title: 'private' }] },
      { startAt: 0, endAt: 3, events: [] }]) {
      const f = fixture('mobile.calendar.query_free_busy');
      const promise = f.invoke({ startAt: 1, endAt: 3 });
      const rejection = expect(promise).rejects.toMatchObject({ code: 'PROTOCOL_ERROR', message: 'Invalid personal device result' });
      f.result({ ...value, capturedAt: Date.now(), timeZone: 'UTC', accessScope: 'app_only', truncated: false });
      await rejection; f.service.close();
    }
  });
  it('keeps app-only empty results explicit instead of claiming complete availability', async () => {
    const f = fixture('mobile.calendar.query_free_busy');
    const promise = f.invoke({ startAt: 1, endAt: 3 });
    f.result({ startAt: 1, endAt: 3, capturedAt: Date.now(), timeZone: 'UTC', accessScope: 'app_only', truncated: false, events: [] });
    await expect(promise).resolves.toMatchObject({ content: [{ value: { accessScope: 'app_only', events: [] } }] }); f.service.close();
  });
  it('rejects extra contact fields and discards late results after cancellation', async () => {
    const f = fixture('mobile.contacts.pick');
    const promise = f.invoke({ field: 'phone' });
    const rejection = expect(promise).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    f.result({ id: 'selected', name: 'Selected contact', phones: ['123'], emails: ['private@example.test'] });
    await rejection;
    f.sent.length = 0;
    const controller = new AbortController(); const next = f.invoke({ field: 'email' }, controller.signal);
    const cancelled = expect(next).rejects.toMatchObject({ code: 'TOOL_CANCELLED' });
    controller.abort();
    f.result({ id: 'selected', name: 'Selected contact', phones: [], emails: ['selected@example.test'] });
    await cancelled; f.service.close();
  });
  it('strips photo metadata, binds ownership, and revokes uploads after cancellation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-personal-upload-')); const uploads = new EndpointUploadService(root);
    try {
      const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } })
        .withExif({ IFD0: { Artist: 'private metadata' } }).jpeg().toBuffer();
      const grant = uploads.createGrant('one', 'phone', Date.now(), 'personal', 'phone-owner');
      expect(grant.maxFiles).toBe(1);
      const file = await uploads.uploadValidated({ invocationId: 'one', endpointId: 'phone', token: grant.token, name: 'photo.jpg', mimeType: 'image/jpeg', bytes });
      expect(file).toMatchObject({ endpointId: 'phone', principalId: 'phone-owner' });
      expect((await sharp(uploads.readFile(file.fileId)!).metadata()).exif).toBeUndefined();
      uploads.abort('one'); expect(uploads.getFile(file.fileId)).toBeUndefined();
      await expect(uploads.uploadValidated({ invocationId: 'one', endpointId: 'phone', token: grant.token, name: 'late.txt', mimeType: 'text/plain', bytes: Buffer.from('private') })).rejects.toMatchObject({ code: 'INVALID_UPLOAD_GRANT' });
    } finally { uploads.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
