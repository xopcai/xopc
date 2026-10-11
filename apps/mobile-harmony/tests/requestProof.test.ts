import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerRequestProof, signedHttpRequest, connectionProof } from '../entry/src/main/ets/service/requestProof.ets';

const vector = JSON.parse(readFileSync(new URL('../../../packages/gateway-contract/test-fixtures/device-request-proof-v1.json', import.meta.url), 'utf8'));
const encode = (value: string) => new TextEncoder().encode(value);
const hash = async (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
afterEach(() => vi.useRealTimers());

describe('Harmony request proof wire bytes', () => {
  it('matches the shared Unicode/query/header vector', async () => {
    vi.useFakeTimers(); vi.setSystemTime(vector.input.timestamp);
    const sign = vi.fn(async () => Buffer.from(vector.signature, 'base64').toString('base64url'));
    registerRequestProof(vector.input.credential, vector.input.gatewayId, ['https://gateway.example'], {
      encodeText: encode, digest: hash, sign, nonce: async () => vector.input.nonce,
    } as never);
    const request = vi.fn(async () => ({ responseCode: 200 }));
    const headers = { Authorization: 'Bearer ' + vector.input.credential, 'Content-Type': 'application/json', 'Idempotency-Key': vector.input.headers[1] };
    await signedHttpRequest({ request } as never, 'https://gateway.example' + vector.input.target,
      { customMethod: 'POST', header: headers, extraData: vector.input.body } as never);
    expect(sign).toHaveBeenCalledWith(vector.message);
    expect(request).toHaveBeenCalledOnce();
    expect((headers as Record<string, string>)['X-Xopc-Proof']).toBe(`${vector.input.timestamp}.${vector.input.nonce}.${vector.bodyDigest}.${Buffer.from(vector.signature, 'base64').toString('base64url')}`);
  });

  it('hashes finalized multipart bytes and binds a voice proxy query', async () => {
    const key = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const sign = vi.fn(async (message: string) => crypto.sign('sha256', Buffer.from(message), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'));
    registerRequestProof('xopc_at_upload', vector.input.gatewayId, ['https://upload.example'], {
      encodeText: encode, digest: hash, sign, nonce: async () => crypto.randomBytes(24).toString('base64url'), uuid: () => 'boundary',
    } as never);
    const options = { method: 'POST', header: { Authorization: 'Bearer xopc_at_upload', 'Content-Type': 'multipart/form-data' },
      multiFormDataList: [{ name: 'audio', remoteFileName: 'voice.m4a', contentType: 'audio/m4a', data: new Uint8Array([0, 1, 255]).buffer }] };
    const request = vi.fn(async () => ({ responseCode: 200 }));
    await signedHttpRequest({ request } as never, 'https://upload.example/api/voice/transcriptions', options as never);
    const sent = request.mock.calls[0] as unknown as [string, { extraData: ArrayBuffer; header: Record<string, string>; multiFormDataList?: unknown }];
    expect(sent[1].multiFormDataList).toBeUndefined();
    expect(sent[1].header['X-Xopc-Proof'].split('.')[2]).toBe(await hash(new Uint8Array(sent[1].extraData)));
    expect(new TextDecoder().decode(sent[1].extraData)).toContain('boundary=xopc-boundary'.replace('boundary=', '--'));
    await connectionProof('wss://upload.example/api/realtime/v1/ws?transport=voice-v3', 'ticket');
    expect(sign.mock.calls.at(-1)?.[0]).toContain('\nCONNECT\n/api/realtime/v1/ws?transport=voice-v3\n');
  });
});
