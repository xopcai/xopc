import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getProjectTrustOptions,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
} from '../trust-store.js';

describe('ProjectTrustStore', () => {
  it('stores decisions and inherits parent trust decisions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-trust-'));
    try {
      const project = join(dir, 'project');
      const child = join(project, 'packages', 'app');
      mkdirSync(child, { recursive: true });
      const store = new ProjectTrustStore(join(dir, 'trust.json'));

      expect(store.get(child)).toBeNull();
      store.set(project, true);

      expect(store.get(child)).toBe(true);
      expect(store.getEntry(child)).toMatchObject({ path: realpathSync(project), decision: true });

      store.set(project, null);
      expect(store.get(child)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects xopc project-local resources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-trust-'));
    try {
      expect(hasTrustRequiringProjectResources(dir)).toBe(false);
      mkdirSync(join(dir, '.xopc', 'extensions'), { recursive: true });
      expect(hasTrustRequiringProjectResources(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('offers saved and session-only trust options', () => {
    const options = getProjectTrustOptions('/tmp/xopc-project', { includeSessionOnly: true });

    expect(options.map((option) => option.label)).toContain('Trust');
    expect(options.map((option) => option.label)).toContain('Trust (this session only)');
    expect(options.map((option) => option.label)).toContain('Do not trust');
    expect(options.map((option) => option.label)).toContain('Do not trust (this session only)');
  });
});
