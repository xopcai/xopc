import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { saveMediaBuffer } from '../../media/store.js';
import { getShareStore, resetShareStoreForTests } from '../../share/share-store.js';
import { archiveSpaceContent } from '../../space/ingest.js';
import { getSpaceItem } from '../../space/repository.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { createDevice, issueDeviceTokenPair, revokeDevice } from '../../storage/sqlite/device-access-repository.js';
import { getOrCreateGatewayIdentity } from '../../storage/sqlite/gateway-identity-repository.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import { proofDigest, requestProofMessage } from '../security/device-request-proof.js';
import type { GatewayService } from '../service.js';

it('streams a scoped library version and shares it with one view across multiple byte ranges', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-library-media-http-'));
  vi.stubEnv('XOPC_STATE_DIR', directory);
  const { db } = openXopcDatabase({ path: join(directory, 'gateway.db') });
  const token = randomUUID();
  const service = {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }),
    getAuthToken: () => token,
    isGatewayReady: () => true,
    getExtensionLoader: () => null,
  } as unknown as GatewayService;
  const server = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const conversationId = randomUUID();
    createConversation({ agentId: 'main', name: 'Test media' }, directory, conversationId);
    const bytes = Buffer.from('0123456789');
    const media = await saveMediaBuffer(bytes, { bucket: 'outbound', originalFilename: 'fixture.mp3', contentType: 'audio/mpeg' });
    const itemId = archiveSpaceContent(db, {
      key: 'test:media', kind: 'chat', conversationId, createdAt: Date.now(),
    }, 'test:media', '音乐', {
      kind: 'audio', mediaId: media.id, size: bytes.length, mimeType: 'audio/mpeg', fileName: '音乐.mp3',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })!;
    const versionId = getSpaceItem(itemId)!.currentVersion.id;
    const path = `/api/spaces/items/${itemId}/versions/${versionId}/content`;
    const issuer = '/api/media/playback-ticket';
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const device = createDevice({ id: randomUUID(), displayName: 'Media fixture', platform: 'android',
      publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) as Parameters<typeof createDevice>[0]['publicKeyJwk'],
      scopes: ['workspace.read'] });
    const credential = issueDeviceTokenPair(device.id).accessToken;
    function issue(target: string) {
      const body = JSON.stringify({ path: target });
      const proof = { timestamp: Date.now(), nonce: randomBytes(24).toString('base64url'), digest: proofDigest(body) };
      const message = requestProofMessage({ gatewayId: getOrCreateGatewayIdentity().id, credential,
        method: 'POST', target: issuer, headers: name => name === 'content-type' ? 'application/json' : undefined, proof });
      const signed = sign('sha256', Buffer.from(message), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return fetch(origin + issuer, { method: 'POST', body, headers: {
        authorization: `Bearer ${credential}`, 'content-type': 'application/json',
        'X-Xopc-Proof': `${proof.timestamp}.${proof.nonce}.${proof.digest}.${signed}`,
      } });
    }

    expect((await fetch(origin + path)).status).toBe(401);
    expect((await issue('/api/shares')).status).toBe(403);
    expect((await issue(`/api/music-generation/sessions/${conversationId}/jobs/${'a'.repeat(64)}/audio`)).status).toBe(403);
    const issued = await issue(path);
    expect(issued.status).toBe(201);
    const ticketPath = (await issued.json() as { path: string }).path;
    const head = await fetch(origin + ticketPath, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('10');
    const partial = await fetch(origin + ticketPath, { headers: { Range: 'bytes=0-1' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 0-1/10');
    expect(partial.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(await partial.text()).toBe('01');
    expect((await fetch(origin + ticketPath.replace(versionId, randomUUID()))).status).toBe(401);
    expect((await fetch(origin + ticketPath + '&download=1')).status).toBe(401);
    revokeDevice(device.id);
    expect((await fetch(origin + ticketPath)).status).toBe(401);

    const shareInput = { spaceVersion: { itemId, versionId }, maxViews: 1, thumbnail: false };
    const ownerHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const webShare = await fetch(origin + '/api/shares', { method: 'POST', headers: ownerHeaders, body: JSON.stringify(shareInput) });
    expect(webShare.status).toBe(201);
    expect((await webShare.json()).payload.fileName).toBe('音乐.mp3');
    const mobileShare = await fetch(origin + '/api/shares/auto', { method: 'POST', headers: ownerHeaders, body: JSON.stringify(shareInput) });
    expect(mobileShare.status).toBe(201);
    const { share } = (await mobileShare.json()).payload;
    const landing = origin + new URL(share.shareUrl).pathname;
    expect(await (await fetch(landing)).text()).toContain('在线播放');
    expect(getShareStore().getById(share.id)?.downloadCount).toBe(0);
    const playback = await fetch(landing + '/playback', { method: 'POST' });
    expect(playback.status).toBe(200);
    const source = (await playback.text()).match(/src="(\/s\/[^"]+\/playback\?ticket=[^"]+)"/)?.[1];
    expect(source).toBeDefined();
    expect((await fetch(landing + '/playback', { method: 'POST' })).status).toBe(410);
    const sharedRange = await fetch(origin + source, { headers: { Range: 'bytes=-3' } });
    expect(sharedRange.status).toBe(206);
    expect(sharedRange.headers.get('content-range')).toBe('bytes 7-9/10');
    expect(await sharedRange.text()).toBe('789');
    const invalidRange = await fetch(origin + source, { headers: { Range: 'bytes=30-' } });
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get('content-range')).toBe('bytes */10');
    expect(getShareStore().getById(share.id)?.downloadCount).toBe(1);
    expect((await fetch(origin + '/api/shares/' + share.id, { method: 'DELETE', headers: ownerHeaders })).status).toBe(200);
    expect((await fetch(origin + source)).status).toBe(410);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    resetShareStoreForTests();
    closeXopcDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
