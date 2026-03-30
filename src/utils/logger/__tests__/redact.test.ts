import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  redactSecret,
  redactSensitiveInfo,
  redactPemBlock,
  redactObject,
  isLogRedactionEnabled,
} from '../redact.js';

describe('redact', () => {
  beforeEach(() => {
    delete process.env.XOPCBOT_LOG_REDACTION;
  });
  afterEach(() => {
    delete process.env.XOPCBOT_LOG_REDACTION;
  });

  it('redacts long secrets', () => {
    const s = 'sk-' + 'a'.repeat(40);
    expect(redactSecret(s)).toContain('…');
    expect(redactSecret('short')).toBe('***');
  });

  it('redacts OpenAI-style keys in text', () => {
    const text = 'key sk-12345678901234567890123456789012 here';
    const out = redactSensitiveInfo(text);
    expect(out).toContain('…');
    expect(out).not.toContain('12345678901234567890123456789012');
  });

  it('redacts PEM blocks', () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----`;
    expect(redactPemBlock(pem)).toContain('[REDACTED]');
  });

  it('redacts sensitive object keys', () => {
    const o = redactObject({ apiKey: 'x'.repeat(30), host: 'localhost' }) as Record<string, unknown>;
    expect(o.host).toBe('localhost');
    expect(String(o.apiKey)).toContain('…');
  });

  it('respects XOPCBOT_LOG_REDACTION=false', () => {
    process.env.XOPCBOT_LOG_REDACTION = 'false';
    expect(isLogRedactionEnabled()).toBe(false);
    const raw = 'sk-12345678901234567890123456789012';
    expect(redactSensitiveInfo(raw)).toBe(raw);
  });
});
