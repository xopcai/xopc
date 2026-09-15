import { describe, it, expect } from 'vitest';
import { sanitizeEnvVars, prepareSafeToolEnv } from '../sanitize-env-vars.js';

describe('sanitizeEnvVars', () => {
  it('blocks known API key env vars', () => {
    const r = sanitizeEnvVars({
      OPENAI_API_KEY: 'sk-123456789012345678901234567890',
      HOME: '/home/u',
      PATH: '/usr/bin',
    });
    expect(r.blocked).toContain('OPENAI_API_KEY');
    expect(r.safe.HOME).toBe('/home/u');
    expect(r.safe.PATH).toBe('/usr/bin');
  });

  it('allows explicitly listed vars even when blocked by pattern', () => {
    const r = sanitizeEnvVars(
      { OPENAI_API_KEY: 'secret', OTHER: 'ok' },
      { allowedVars: ['OPENAI_API_KEY'] },
    );
    expect(r.blocked).toHaveLength(0);
    expect(r.safe.OPENAI_API_KEY).toBe('secret');
  });

  it('warns on long base64-like values', () => {
    const longB64 = 'A'.repeat(90);
    const r = sanitizeEnvVars({ SOME_VAR: longB64 });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.safe.SOME_VAR).toBeUndefined();
  });
});

describe('prepareSafeToolEnv', () => {
  it('returns safe env without leaking secrets', () => {
    const env = prepareSafeToolEnv({
      OPENAI_API_KEY: 'sk-123456789012345678901234567890',
      HOME: '/tmp/h',
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.HOME).toBe('/tmp/h');
  });
});

it('rejects startup injection and malformed explicitly allowed values', () => {
  const env = prepareSafeToolEnv({ NODE_OPTIONS: '--require /tmp/inject.js', BASH_ENV: '/tmp/inject.sh', HOME: '/tmp/invalid\0', CUSTOM_TOKEN: 'bad\0' },
    { allowedVars: ['NODE_OPTIONS', 'BASH_ENV', 'HOME', 'CUSTOM_TOKEN'] });
  expect(env).toEqual({ HOME: '/tmp' });
});

it('preserves explicitly allowed credential data while still validating its structure', () => {
  const token = 'A'.repeat(100);
  expect(prepareSafeToolEnv({ CUSTOM_TOKEN: token }, { allowedVars: ['CUSTOM_TOKEN'] }).CUSTOM_TOKEN).toBe(token);
});
