import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ProcessResult } from '../../../process/process-spec.js';
import { extractAuthorizationUrl } from '../authorization.js';
import { larkAdapter } from '../adapters/lark.js';
import { wecomAdapter } from '../adapters/wecom.js';
import { normalizeCliResult, validateActionInput } from '../protocol.js';
import { verifyIntegrity } from '../installer.js';

const output = (patch: Partial<ProcessResult> = {}): ProcessResult => ({ exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, aborted: false, outputTruncated: false, terminationVerified: true, ...patch });
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('CLI protocols', () => {
  it('uses the complete structured authorization URL and ignores partial or foreign URLs', () => {
    const event = JSON.stringify({ verification_uri: 'https://open.feishu.cn/verify', verification_uri_complete: 'https://open.feishu.cn/verify?code=abc' });
    expect(extractAuthorizationUrl(event, ['open.feishu.cn'], 'verification_uri_complete')).toBe('https://open.feishu.cn/verify?code=abc');
    expect(extractAuthorizationUrl('https://open.feishu.cn/verify?code=par', ['open.feishu.cn'])).toBeUndefined();
    expect(extractAuthorizationUrl('https://open.feishu.cn.evil.test/verify\n', ['open.feishu.cn'])).toBeUndefined();
    expect(extractAuthorizationUrl('https://open.feishu.cn/verify?code=abc\n', ['open.feishu.cn'])).toBe('https://open.feishu.cn/verify?code=abc');
  });
  it('accepts partial Lark consent only when the CLI confirms a completed login', () => {
    const decode = larkAdapter.authorizationSteps[1]!.decodeResult!;
    const event = { event: 'authorization_complete', user_open_id: 'test-user', warning: { type: 'missing_scope' }, missing: ['optional'], granted: ['read'] };
    expect(() => decode(output({ exitCode: 3, stdout: JSON.stringify(event) }))).not.toThrow();
    expect(() => decode(output({ exitCode: 3, stdout: JSON.stringify({ ...event, user_open_id: '' }) }))).toThrow();
    expect(() => decode(output({ exitCode: 3, stdout: JSON.stringify({ ...event, warning: undefined }) }))).toThrow();
    expect(() => decode(output({ exitCode: 1, stdout: JSON.stringify(event) }))).toThrow();
    expect(() => decode(output({ exitCode: 3, stdout: '{"event":"authorization_failed","error":"access denied"}' }))).toThrow('access denied');
  });
  it('reports structured login failures without exposing credential values or links', () => {
    const decode = larkAdapter.authorizationSteps[1]!.decodeResult!;
    try {
      decode(output({ exitCode: 3, stderr: JSON.stringify({ ok: false, error: { message: 'invalid client_secret=private-value at https://example.com/?code=private-code' } }) }));
      expect.fail('Expected login failure');
    } catch (error) {
      expect(String(error)).toContain('invalid client_secret=[REDACTED]');
      expect(String(error)).not.toContain('private-value');
      expect(String(error)).not.toContain('private-code');
    }
  });
  it('uses real Lark schema and preserves JSON arguments without shell interpolation', () => {
    const action = larkAdapter.decodeSchema('calendar.events.create', fixture('calendar-events-create'));
    const input = { params: { calendar_id: 'primary' }, data: { summary: '$(touch /tmp/never); "meeting"', start_time: { timestamp: '1800000000' }, end_time: { timestamp: '1800000300' } } };
    validateActionInput(action, input);
    const args = larkAdapter.actionArgs(action, input);
    expect(args.slice(0, 3)).toEqual(['calendar', 'events', 'create']);
    expect(args.at(-1)).toBe(JSON.stringify(input.data));
    expect(() => validateActionInput(action, { ...input, executable: 'sh' })).toThrow('Invalid action input');
  });
  it('does not execute uncurated discovered actions', () => {
    expect(() => larkAdapter.decodeSchema('calendar.calendars.delete', fixture('calendar-calendars-list'))).toThrow();
  });
  it('distinguishes success, provider rejection and uncertain writes', () => {
    expect(normalizeCliResult(larkAdapter, output({ stdout: '{"ok":true,"data":{"id":"1"}}' }), 'write')).toMatchObject({ outcome: 'success', data: { id: '1' } });
    expect(normalizeCliResult(wecomAdapter, output({ stdout: '{"errcode":5,"errmsg":"denied"}' }), 'read')).toMatchObject({ outcome: 'failed' });
    expect(normalizeCliResult(larkAdapter, output({ stdout: 'broken' }), 'write')).toMatchObject({ outcome: 'unknown' });
    expect(normalizeCliResult(larkAdapter, output({ stdout: '{}' }), 'write')).toMatchObject({ outcome: 'unknown', error: { kind: 'protocol' } });
    expect(normalizeCliResult(larkAdapter, output({ timedOut: true }), 'write')).toMatchObject({ outcome: 'unknown' });
    expect(normalizeCliResult(larkAdapter, output({ spawnErrorCode: 'ENOENT' }), 'write')).toMatchObject({ outcome: 'failed' });
  });
  it('refuses truncated JSON and wrong artifact integrity', () => {
    expect(normalizeCliResult(larkAdapter, output({ outputTruncated: true }), 'read').outcome).toBe('failed');
    expect(() => verifyIntegrity(Buffer.from('bad'), 'sha256-' + '0'.repeat(64))).toThrow('integrity');
  });
  it('handles local WeCom schema references and pinned Lark document shortcuts', () => {
    const action = wecomAdapter.decodeSchema('todo.create', { method: 'todo.create', request: { $ref: 'Todo' }, schemas: {
      Todo: { type: 'object', properties: { owner: { $ref: 'Owner' } }, required: ['owner'] },
      Owner: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    } });
    validateActionInput(action, { owner: { id: 'user' } });
    expect(() => validateActionInput(action, { owner: { id: 123 } })).toThrow();
    const search = larkAdapter.staticActions!['docs.search']!;
    validateActionInput(search, { query: 'notes', page_token: 'next', page_size: 20 });
    expect(larkAdapter.actionArgs(search, { query: 'notes', page_token: 'next' })).toEqual(['docs', '+search', '--as', 'user', '--format', 'json', '--query', 'notes', '--page-token', 'next']);
  });
  it('requires verified user identity rather than silently using bot identity', () => {
    expect(() => larkAdapter.decodeIdentity(output({ stdout: '{"appId":"a","identities":{"user":{"available":false},"bot":{"available":true}}}' }))).toThrow();
    expect(larkAdapter.decodeIdentity(output({ stdout: '{"appId":"a","identities":{"user":{"available":true,"verified":true,"openId":"u","scope":"read write"}}}' }))).toMatchObject({ key: 'a:u', scopes: ['read', 'write'] });
  });
});
