import { describe, expect, it } from 'vitest';
import { endpointHelloSigningPayload } from '../../../packages/endpoint-tools-protocol/src/index';
import { endpointProof, XopcCursors } from '../entry/src/main/ets/common/realtimeProtocol';

describe('Harmony realtime protocol', () => {
  it('signs exactly the canonical endpoint hello', () => {
    const hello = {
      principalId: 'device', endpointId: 'harmonyos:device', connectionInstanceId: 'uuid',
      displayName: '中文 "phone"', kind: 'mobile' as const, platform: 'harmonyos', appVersion: '0.1.0',
      availability: 'foreground' as const, nonce: 'nonce', signedAt: 123, signature: 'ignored', tools: [],
    };
    expect(endpointProof(hello)).toBe(endpointHelloSigningPayload(hello));
  });

  it('retains reconnect cursors and suppresses duplicates and unsolicited topics', () => {
    const cursors = new XopcCursors();
    cursors.add('run:one');
    expect(cursors.accept('run:one', 1)).toBe(true);
    expect(cursors.accept('run:one', 1)).toBe(false);
    expect(cursors.accept('run:unknown', 1)).toBe(false);
    expect(cursors.accept('run:one', NaN)).toBe(false);
    cursors.add('run:one');
    expect(cursors.snapshot()).toEqual([{ topic: 'run:one', afterSeq: 1 }]);
    cursors.remove('run:one');
    expect(cursors.snapshot()).toEqual([]);
  });
});
