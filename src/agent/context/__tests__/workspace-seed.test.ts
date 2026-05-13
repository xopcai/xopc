import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { seedWorkspaceProfileMarkdownFiles } from '../workspace-seed.js';
import { AGENT_PROFILE_MARKDOWN_SYSTEM_FILES } from '../workspace.js';
import { WORKSPACE_FILES } from '../../../config/paths.js';

describe('workspace-seed', () => {
  it('creates missing profile Markdown files from templates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-seed-'));
    seedWorkspaceProfileMarkdownFiles(dir);
    const expected = [...AGENT_PROFILE_MARKDOWN_SYSTEM_FILES, WORKSPACE_FILES.BOOTSTRAP];
    for (const name of expected) {
      expect(existsSync(join(dir, name))).toBe(true);
    }
  });

  it('replaces identity placeholder when displayName is provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-seed-'));
    seedWorkspaceProfileMarkdownFiles(dir, { displayName: 'Research Buddy' });
    const identity = readFileSync(join(dir, WORKSPACE_FILES.IDENTITY), 'utf-8');
    expect(identity).toContain('Research Buddy');
    expect(identity).not.toContain('_(pick something you like)_');
  });
});
