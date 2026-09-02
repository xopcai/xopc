import { describe, expect, it } from 'vitest';

import { buildSupportInvestigationPrompt } from '../build-support-investigation-prompt.js';
import type { SupportReport } from '../types.js';

function report(markdown: string): SupportReport {
  return {
    schemaVersion: 1,
    title: '[Bug] no reply',
    capturedAt: '2026-09-02T00:00:00.000Z',
    occurredAt: '2026-09-02T00:00:00.000Z',
    problem: 'no reply',
    environment: {
      xopcVersion: '1.0.0',
      nodeVersion: 'v22.0.0',
      platform: 'darwin',
      arch: 'arm64',
    },
    doctor: [],
    logs: [],
    logWindow: {
      from: '2026-09-01T23:55:00.000Z',
      to: '2026-09-02T00:05:00.000Z',
    },
    redaction: { replacements: 0 },
    markdown,
  };
}

describe('buildSupportInvestigationPrompt', () => {
  it('asks the main agent for a read-only investigation and an issue draft', () => {
    const prompt = buildSupportInvestigationPrompt(report('# diagnostic evidence'));

    expect(prompt).toContain('main agent');
    expect(prompt).toContain('第一轮只能执行只读排查');
    expect(prompt).toContain('Markdown Issue 草稿');
    expect(prompt).toContain('read_media');
    expect(prompt).toContain('<user_problem_untrusted>\nno reply\n</user_problem_untrusted>');
    expect(prompt).not.toContain('# diagnostic evidence');
  });

  it('does not inline a large diagnostic report into the chat message', () => {
    const prompt = buildSupportInvestigationPrompt(report('问'.repeat(100_000)));

    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThan(32 * 1024);
    expect(prompt).not.toContain('问'.repeat(100));
  });
});
