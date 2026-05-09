import { describe, expect, it } from 'vitest';

import { ProviderHttpError, TimeoutAbortError } from '../../media-shared/http/index.js';
import {
  FailoverError,
  classifyAttemptError,
  describeFailoverError,
  isFailoverError,
  reasonFromHttpStatus,
  type FallbackAttempt,
} from '../failover-error.js';

describe('reasonFromHttpStatus', () => {
  it.each([
    [undefined, 'unknown'],
    [200, 'unknown'],
    [400, 'bad_request'],
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not_found'],
    [408, 'timeout'],
    [429, 'rate_limit'],
    [499, 'bad_request'],
    [500, 'server_error'],
    [502, 'server_error'],
    [503, 'server_error'],
  ])('status %s → %s', (status, expected) => {
    expect(reasonFromHttpStatus(status as number | undefined)).toBe(expected);
  });
});

describe('classifyAttemptError', () => {
  it('classifies ProviderHttpError using HTTP status + code', () => {
    const e = new ProviderHttpError({
      label: 'https://api.openai.com',
      status: 429,
      code: 'rate_limit',
      messageOverride: 'Rate limited',
    });
    expect(classifyAttemptError(e)).toEqual({
      reason: 'rate_limit',
      status: 429,
      code: 'rate_limit',
      message: 'Rate limited',
    });
  });

  it('classifies TimeoutAbortError as timeout', () => {
    const cls = classifyAttemptError(new TimeoutAbortError(5000));
    expect(cls.reason).toBe('timeout');
  });

  it('classifies AbortError-like values as aborted', () => {
    const e = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(classifyAttemptError(e).reason).toBe('aborted');
  });

  it('classifies generic transport errors as network', () => {
    expect(classifyAttemptError(new Error('fetch failed: ECONNREFUSED')).reason).toBe('network');
  });

  it('falls back to unknown for unrecognised values', () => {
    expect(classifyAttemptError('weird').reason).toBe('unknown');
  });
});

describe('FailoverError', () => {
  const attempts: FallbackAttempt[] = [
    { provider: 'openai', model: 'gpt-image-1', error: 'timeout', reason: 'timeout' },
    { provider: 'dashscope', model: 'wan2.6-t2i', error: 'auth failed', reason: 'auth', status: 401 },
  ];

  it('exposes convenience accessors from the last attempt', () => {
    const err = new FailoverError({ capability: 'image-generation', attempts });
    expect(err.reason).toBe('auth');
    expect(err.status).toBe(401);
    expect(err.provider).toBe('dashscope');
    expect(err.model).toBe('wan2.6-t2i');
    expect(err.message).toContain('image-generation');
    expect(err.message).toContain('2 attempt(s)');
    expect(err.message).toContain('auth failed');
  });

  it('isFailoverError works for instance + duck-typed objects', () => {
    const err = new FailoverError({ capability: 'image-generation', attempts });
    expect(isFailoverError(err)).toBe(true);
    expect(isFailoverError({ name: 'FailoverError', capability: 'x', attempts: [] })).toBe(true);
    expect(isFailoverError(new Error('plain'))).toBe(false);
    expect(isFailoverError(null)).toBe(false);
  });

  it('describeFailoverError formats per-attempt lines', () => {
    const err = new FailoverError({ capability: 'image-generation', attempts });
    const description = describeFailoverError(err);
    expect(description).toContain('[image-generation] 2 attempt(s) failed');
    expect(description).toContain('1. openai/gpt-image-1 [timeout]');
    expect(description).toContain('2. dashscope/wan2.6-t2i [auth] status=401 - auth failed');
  });

  it('attempts list is frozen', () => {
    const err = new FailoverError({ capability: 'image-generation', attempts });
    expect(() => (err.attempts as FallbackAttempt[]).push(attempts[0])).toThrow();
  });
});
