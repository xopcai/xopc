import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { seedAgentProfileMarkdownFiles } from '../workspace-seed.js';
import { AGENT_PROFILE_MARKDOWN_SYSTEM_FILES } from '../workspace.js';

describe('workspace-seed', () => {
  it('creates missing profile Markdown files under profileDir from templates', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-seed-'));
    const profileDir = join(root, 'profile');
    const markdownWs = join(root, 'workspace');
    seedAgentProfileMarkdownFiles(profileDir, markdownWs);
    for (const name of AGENT_PROFILE_MARKDOWN_SYSTEM_FILES) {
      expect(existsSync(join(profileDir, name))).toBe(true);
    }
  });

  it('replaces identity placeholder when displayName is provided', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-seed-'));
    const profileDir = join(root, 'profile');
    const markdownWs = join(root, 'workspace');
    seedAgentProfileMarkdownFiles(profileDir, markdownWs, { displayName: 'Research Buddy' });
    const identity = readFileSync(join(profileDir, 'IDENTITY.md'), 'utf-8');
    expect(identity).toContain('Research Buddy');
    expect(identity).not.toContain('_(pick something you like)_');
  });
});
