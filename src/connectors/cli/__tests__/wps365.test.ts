import { describe, expect, it } from 'vitest';

import type { ProcessResult } from '../../../process/process-spec.js';
import { connectionCandidates } from '../../connection-candidates.js';
import { wps365Adapter } from '../adapters/wps365.js';
import { normalizeCliResult, validateActionInput } from '../protocol.js';

const output = (patch: Partial<ProcessResult> = {}): ProcessResult => ({ exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, aborted: false, outputTruncated: false, terminationVerified: true, ...patch });

describe('WPS 365 pinned protocol', () => {
  it('discovers one WPS connection through Chinese and English queries', () => {
    for (const query of ['WPS document search', 'WPS365 calendar', '金山文档列表']) {
      expect(connectionCandidates(query)).toContainEqual(expect.objectContaining({ candidateRef: 'wps365-workspace' }));
    }
  });
  it('exposes only curated reads and refuses identity or executable overrides', () => {
    expect(Object.keys(wps365Adapter.curatedActions)).toHaveLength(14);
    expect(new Set(Object.values(wps365Adapter.curatedActions))).toEqual(new Set(['read']));
    const action = wps365Adapter.staticActions!['drive.file.list']!;
    const input = { 'drive-id': '--token-type=app', 'parent-id': '$(touch /tmp/never)', 'page-size': 20, 'with-permission': true };
    validateActionInput(action, input);
    expect(wps365Adapter.actionArgs(action, input)).toEqual(['drive', 'file', 'list', '--token-type', 'delegated', '--output', 'json', '--page-size=20', '--with-permission=true', '--', '--token-type=app', '$(touch /tmp/never)']);
    for (const injected of [{ token_type: 'app' }, { executable: 'sh' }, { 'page-size': 'bad' }]) expect(() => validateActionInput(action, { ...input, ...injected })).toThrow();
  });
  it('uses only verified user and enterprise identifiers', () => {
    const success = output({ stdout: JSON.stringify({ code: 0, data: { id: 'u1', company_id: 'c1', user_name: 'Test' } }) });
    expect(wps365Adapter.decodeIdentity(success)).toMatchObject({ key: 'c1:u1', identity: { kind: 'user', userId: 'u1', companyId: 'c1' } });
    expect(wps365Adapter.statusArgs).toContain('delegated');
    for (const bad of [output({ stdout: '{"code":0,"data":{"id":"u1"}}' }), { ...success, timedOut: true }, { ...success, outputTruncated: true }]) expect(() => wps365Adapter.decodeIdentity(bad)).toThrow();
  });
  it('decodes full WPS response envelopes and rejects malformed success', () => {
    expect(normalizeCliResult(wps365Adapter, output({ stdout: '{"code":0,"data":{"items":[],"next_page_token":"next"}}' }), 'read')).toMatchObject({ outcome: 'success', data: { next_page_token: 'next' } });
    expect(normalizeCliResult(wps365Adapter, output({ stdout: '{"data":{}}' }), 'read')).toMatchObject({ outcome: 'failed', error: { kind: 'protocol' } });
    expect(normalizeCliResult(wps365Adapter, output({ stdout: '{"code":0}' }), 'read')).toMatchObject({ outcome: 'failed', error: { kind: 'protocol' } });
  });
  it('separates entitlement and authorization failures without exposing diagnostics', () => {
    const entitlement = normalizeCliResult(wps365Adapter, output({ exitCode: 2, stderr: 'ErrPrivileges: interface_company_doc token=secret' }), 'read');
    expect(entitlement.error?.message).toContain('subscription');
    expect(entitlement.error?.message).not.toContain('secret');
    expect(normalizeCliResult(wps365Adapter, output({ exitCode: 2, stderr: 'not logged in' }), 'read').error?.message).toContain('Reconnect');
    expect(normalizeCliResult(wps365Adapter, output({ exitCode: 2, stderr: 'forbidden scope' }), 'read').error?.message).toContain('administrator');
  });
});
