/**
 * API key rotation tests. Verify that:
 *  - the rotator advances on rotatable failures (401/403/429/quota text)
 *  - it does NOT rotate on transient infra errors (5xx, network)
 *  - executeWithApiKeyRotation throws synchronously when no keys are configured
 *  - empty / duplicate keys are dropped
 *  - the success path returns immediately without touching backup keys
 */

import { describe, expect, it, vi } from 'vitest';
import {
  collectProviderApiKeysForExecution,
  executeWithApiKeyRotation,
  isRotatableAuthFailure,
} from '../index.js';

describe('isRotatableAuthFailure', () => {
  it('matches auth / quota signals', () => {
    expect(isRotatableAuthFailure('HTTP 401 Unauthorized')).toBe(true);
    expect(isRotatableAuthFailure('forbidden')).toBe(true);
    expect(isRotatableAuthFailure('rate limit exceeded')).toBe(true);
    expect(isRotatableAuthFailure('You exceeded your current quota')).toBe(true);
    expect(isRotatableAuthFailure('Invalid API key')).toBe(true);
  });

  it('does not match generic infra errors', () => {
    expect(isRotatableAuthFailure('500 Internal Server Error')).toBe(false);
    expect(isRotatableAuthFailure('socket hang up')).toBe(false);
    expect(isRotatableAuthFailure('')).toBe(false);
  });
});

describe('collectProviderApiKeysForExecution', () => {
  it('puts the primary key first and dedupes', () => {
    expect(
      collectProviderApiKeysForExecution({
        primaryApiKey: 'sk-a',
        extraApiKeys: ['sk-b', 'sk-a', 'sk-c'],
      }),
    ).toEqual(['sk-a', 'sk-b', 'sk-c']);
  });

  it('drops empty / whitespace keys', () => {
    expect(
      collectProviderApiKeysForExecution({
        primaryApiKey: '   ',
        extraApiKeys: ['sk-1', '', '   ', 'sk-2'],
      }),
    ).toEqual(['sk-1', 'sk-2']);
  });

  it('handles missing primary', () => {
    expect(collectProviderApiKeysForExecution({ extraApiKeys: ['sk-1'] })).toEqual(['sk-1']);
  });
});

describe('executeWithApiKeyRotation', () => {
  it('returns the first successful key result without calling later keys', async () => {
    const execute = vi.fn(async (key: string) => `ok:${key}`);
    const result = await executeWithApiKeyRotation({
      provider: 'test',
      apiKeys: ['k1', 'k2', 'k3'],
      execute,
    });
    expect(result).toBe('ok:k1');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rotates past rotatable failures and resolves with a later key', async () => {
    const seen: string[] = [];
    const execute = vi.fn(async (key: string) => {
      seen.push(key);
      if (key === 'bad-1' || key === 'bad-2') {
        throw new Error('HTTP 401 Unauthorized');
      }
      return `ok:${key}`;
    });
    const result = await executeWithApiKeyRotation({
      provider: 'test',
      apiKeys: ['bad-1', 'bad-2', 'good'],
      execute,
    });
    expect(result).toBe('ok:good');
    expect(seen).toEqual(['bad-1', 'bad-2', 'good']);
  });

  it('does NOT rotate on non-rotatable failures (e.g. 5xx)', async () => {
    const execute = vi.fn(async (_key: string) => {
      throw new Error('500 Internal Server Error');
    });
    await expect(
      executeWithApiKeyRotation({
        provider: 'test',
        apiKeys: ['k1', 'k2'],
        execute,
      }),
    ).rejects.toThrow(/500/);
    // Non-rotatable on first key → bail immediately, no second attempt.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('throws synchronously when no usable keys are configured', async () => {
    await expect(
      executeWithApiKeyRotation({
        provider: 'test',
        apiKeys: [],
        execute: vi.fn(),
      }),
    ).rejects.toThrow(/no api keys configured/i);
  });

  it('fires the onRetry observer between attempts', async () => {
    const onRetry = vi.fn();
    const execute = vi.fn(async (key: string) => {
      if (key === 'k1') throw new Error('HTTP 429 Too Many Requests');
      return key;
    });
    await executeWithApiKeyRotation({
      provider: 'test',
      apiKeys: ['k1', 'k2'],
      execute,
      onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'k1', attempt: 0, message: expect.stringMatching(/429/) }),
    );
  });
});
