import { describe, expect, it } from 'vitest';

import type { ProcessResult } from '../../../process/process-spec.js';
import { extractAuthorizationUrl } from '../authorization.js';
import { fixtureAdapter } from './fixture-adapter.js';
import { normalizeCliResult, validateActionInput } from '../protocol.js';
import { verifyIntegrity } from '../installer.js';

const output = (patch: Partial<ProcessResult> = {}): ProcessResult => ({ exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, aborted: false, outputTruncated: false, terminationVerified: true, ...patch });

describe('CLI protocols', () => {
  it('uses the complete structured authorization URL and ignores partial or foreign URLs', () => {
    const event = JSON.stringify({ verification_uri: 'https://auth.example.test/verify', verification_uri_complete: 'https://auth.example.test/verify?code=abc' });
    expect(extractAuthorizationUrl(event, ['auth.example.test'], 'verification_uri_complete')).toBe('https://auth.example.test/verify?code=abc');
    expect(extractAuthorizationUrl('https://auth.example.test/verify?code=par', ['auth.example.test'])).toBeUndefined();
    expect(extractAuthorizationUrl('https://auth.example.test.evil.test/verify\n', ['auth.example.test'])).toBeUndefined();
    expect(extractAuthorizationUrl('https://auth.example.test/verify?code=abc\n', ['auth.example.test'])).toBe('https://auth.example.test/verify?code=abc');
  });

  it('distinguishes success, provider rejection and uncertain writes', () => {
    expect(normalizeCliResult(fixtureAdapter, output({ stdout: '{"id":"1"}' }), 'write')).toMatchObject({ outcome: 'success', data: { id: '1' } });
    expect(normalizeCliResult(fixtureAdapter, output({ stdout: '{"error":"denied"}' }), 'read')).toMatchObject({ outcome: 'failed' });
    expect(normalizeCliResult(fixtureAdapter, output({ stdout: 'broken' }), 'write')).toMatchObject({ outcome: 'unknown' });
    expect(normalizeCliResult(fixtureAdapter, output({ timedOut: true }), 'write')).toMatchObject({ outcome: 'unknown' });
    expect(normalizeCliResult(fixtureAdapter, output({ spawnErrorCode: 'ENOENT' }), 'write')).toMatchObject({ outcome: 'failed' });
  });
  it('refuses truncated JSON and wrong artifact integrity', () => {
    expect(normalizeCliResult(fixtureAdapter, output({ outputTruncated: true }), 'read').outcome).toBe('failed');
    expect(() => verifyIntegrity(Buffer.from('bad'), 'sha256-' + '0'.repeat(64))).toThrow('integrity');
  });
  it('preserves literal JSON arguments and rejects uncurated actions', () => {
    const schema = { method: 'records.create', request: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } };
    const action = fixtureAdapter.decodeSchema('records.create', schema);
    const input = { title: 'literal $(command); "meeting"' };
    validateActionInput(action, input);
    expect(fixtureAdapter.actionArgs(action, input)).toEqual(['records', 'create', '--json', JSON.stringify(input)]);
    expect(() => validateActionInput(action, { ...input, executable: 'sh' })).toThrow();
    expect(() => fixtureAdapter.decodeSchema('records.delete', { ...schema, method: 'records.delete' })).toThrow();
  });
});
