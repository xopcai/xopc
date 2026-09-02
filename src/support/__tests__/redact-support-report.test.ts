import { describe, expect, it } from 'vitest';

import { SupportRedactor } from '../redact-support-report.js';

describe('SupportRedactor', () => {
  it('removes secrets, private paths, and URL query data', () => {
    const redactor = new SupportRedactor({
      homeDir: '/Users/alice',
      stateDir: '/Users/alice/.xopc',
      workspaceDir: '/Users/alice/workspace',
    });
    const result = redactor.text(
      'path=/Users/alice/.xopc/logs/app.log "apiKey":"sk-abcdefghijklmnop" OPENAI_API_KEY=another-secret https://example.com/path?token=secret',
    );

    expect(result).toContain('<STATE_DIR>/logs/app.log');
    expect(result).toContain('"apiKey":[REDACTED]');
    expect(result).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(result).toContain('https://example.com/path');
    expect(result).not.toContain('abcdefghijklmnop');
    expect(result).not.toContain('?token=secret');
    expect(redactor.replacements).toBeGreaterThanOrEqual(3);
  });

  it('pseudonymizes identifiers consistently', () => {
    const redactor = new SupportRedactor();
    redactor.addIdentifier('private-session', 'session');
    expect(redactor.identifier('private-session', 'session')).toBe(
      redactor.identifier('private-session', 'session'),
    );
    expect(redactor.identifier('private-session', 'session')).not.toContain('private-session');
    expect(redactor.text('failed private-session')).not.toContain('private-session');
  });
});
