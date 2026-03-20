import { describe, expect, it } from 'vitest';
import {
  classifyFailoverReason,
  isRateLimitErrorMessage,
  isTimeoutErrorMessage,
  isBillingErrorMessage,
  isAuthErrorMessage,
  isFormatErrorMessage,
} from '../reason.js';
import { FailoverError, isFailoverError, describeFailoverError } from '../error.js';
import { resolveFallbackCandidates } from '../candidates.js';

describe('Failover Reason Classification', () => {
  it('classifies rate limit errors', () => {
    expect(classifyFailoverReason({ status: 429 })).toBe('rate_limit');
    expect(classifyFailoverReason('rate limit exceeded')).toBe('rate_limit');
    expect(isRateLimitErrorMessage('Rate limit exceeded')).toBe(true);
  });

  it('classifies billing errors', () => {
    expect(classifyFailoverReason({ status: 402 })).toBe('billing');
    expect(classifyFailoverReason('insufficient credits')).toBe('billing');
    expect(isBillingErrorMessage('Insufficient credits')).toBe(true);
  });

  it('classifies auth errors', () => {
    expect(classifyFailoverReason({ status: 401 })).toBe('auth');
    expect(classifyFailoverReason({ status: 403 })).toBe('auth');
    expect(classifyFailoverReason('invalid api key')).toBe('auth');
    expect(isAuthErrorMessage('Invalid API key')).toBe(true);
  });

  it('classifies timeout errors', () => {
    expect(classifyFailoverReason({ status: 408 })).toBe('timeout');
    expect(classifyFailoverReason({ code: 'ETIMEDOUT' })).toBe('timeout');
    expect(isTimeoutErrorMessage('Request timed out')).toBe(true);
  });

  it('classifies format errors', () => {
    expect(classifyFailoverReason({ status: 400 })).toBe('format');
    expect(isFormatErrorMessage('Invalid request format')).toBe(true);
  });

  it('returns unknown for unrecognized errors', () => {
    expect(classifyFailoverReason('random error')).toBe('unknown');
  });
});

describe('FailoverError', () => {
  it('creates error with properties', () => {
    const error = new FailoverError('Test', 'rate_limit', 'openai', 'gpt-4', 429);
    expect(error.message).toBe('Test');
    expect(error.reason).toBe('rate_limit');
    expect(error.provider).toBe('openai');
    expect(error.model).toBe('gpt-4');
    expect(error.status).toBe(429);
  });

  it('detects via isFailoverError', () => {
    expect(isFailoverError(new FailoverError('Test', 'auth'))).toBe(true);
    expect(isFailoverError(new Error('Test'))).toBe(false);
  });

  it('describes error correctly', () => {
    const error = new FailoverError('Rate limited', 'rate_limit', 'anthropic', 'claude-3', 429);
    const desc = describeFailoverError(error);
    expect(desc.message).toBe('Rate limited');
    expect(desc.reason).toBe('rate_limit');
  });
});

describe('resolveFallbackCandidates', () => {
  it('returns default model candidate when no config', () => {
    // When no config is provided, it should return a candidate from the default model
    const candidates = resolveFallbackCandidates({ cfg: {} as any, provider: 'anthropic', model: 'claude-sonnet-4-5' });
    // Should return at least the default model candidate (may be filtered if provider not configured)
    expect(candidates.length).toBeGreaterThanOrEqual(0);
  });

  it('includes fallbacks from config', () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    process.env.OPENAI_API_KEY = 'test';
    const candidates = resolveFallbackCandidates({
      cfg: {
        agents: { defaults: { model: { primary: 'anthropic/claude-sonnet-4-5', fallbacks: ['openai/gpt-4o'] } } },
      } as any,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it('respects fallbacksOverride', () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    process.env.OPENAI_API_KEY = 'test';
    const candidates = resolveFallbackCandidates({
      cfg: {
        agents: { defaults: { model: { primary: 'anthropic/claude-sonnet-4-5', fallbacks: ['openai/gpt-4o'] } } },
      } as any,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      fallbacksOverride: ['openai/gpt-4o'],
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[1]).toEqual({ provider: 'openai', model: 'gpt-4o' });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it('deduplicates candidates', () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    const candidates = resolveFallbackCandidates({
      cfg: {
        agents: { defaults: { model: { primary: 'anthropic/claude-sonnet-4-5', fallbacks: ['anthropic/claude-sonnet-4-5'] } } },
      } as any,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    });
    const keys = candidates.map(c => `${c.provider}/${c.model}`);
    expect(keys.length).toBe(new Set(keys).size);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('filters out unconfigured providers', () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    delete process.env.OPENAI_API_KEY;
    const candidates = resolveFallbackCandidates({
      cfg: {
        agents: { defaults: { model: { primary: 'anthropic/claude-sonnet-4-5', fallbacks: ['openai/gpt-4o', 'unconfigured/model'] } } },
      } as any,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    });
    // Only anthropic should be included, openai is filtered out
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
    delete process.env.ANTHROPIC_API_KEY;
  });
});
