import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWorkflowCatalog } from '../catalog.js';

const VALID_HEADER = `export const meta = { name: 'demo', description: 'd' }\nawait agent('hi', { label: 'hi' })\n`;

describe('createWorkflowCatalog', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-wf-catalog-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists built-ins when user dir is empty', () => {
    const cat = createWorkflowCatalog({ userDir: dir });
    const entries = cat.list();
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const names = entries.map((e) => e.name);
    expect(names).toContain('audit_repo');
    expect(names).toContain('multi_perspective_review');
    expect(names).toContain('research');
    for (const e of entries) {
      expect(e.source).toBe('builtin');
    }
  });

  it('loads a built-in workflow by name', () => {
    const cat = createWorkflowCatalog({ userDir: dir });
    const loaded = cat.load('audit_repo');
    expect(loaded.source).toBe('builtin');
    expect(loaded.meta.name).toBe('audit_repo');
    expect(loaded.script.length).toBeGreaterThan(100);
  });

  it('throws when loading an unknown name with a hint', () => {
    const cat = createWorkflowCatalog({ userDir: dir });
    expect(() => cat.load('does_not_exist')).toThrow(/not found.*audit_repo/);
  });

  it('saves a user workflow and lists it', () => {
    const cat = createWorkflowCatalog({ userDir: dir });
    const script = `export const meta = { name: 'my_wf', description: 'mine' }\nawait agent('go', { label: 'go' })\n`;
    const { path } = cat.save('my_wf', script);
    expect(path).toBe(join(dir, 'my_wf.js'));
    const entries = cat.list();
    const mine = entries.find((e) => e.name === 'my_wf');
    expect(mine).toBeDefined();
    expect(mine?.source).toBe('user');
  });

  it('refuses to save when meta.name disagrees with save name', () => {
    const cat = createWorkflowCatalog({ userDir: dir });
    expect(() => cat.save('my_wf', VALID_HEADER)).toThrow(/disagrees|does not match/);
  });

  it('user workflow wins on name collision with a built-in', () => {
    writeFileSync(
      join(dir, 'audit_repo.js'),
      `export const meta = { name: 'audit_repo', description: 'user override' }\nawait agent('x', { label: 'x' })\n`,
      'utf-8',
    );
    const cat = createWorkflowCatalog({ userDir: dir });
    const loaded = cat.load('audit_repo');
    expect(loaded.source).toBe('user');
    expect(loaded.meta.description).toBe('user override');
  });

  it('remove deletes a user workflow but never a built-in', () => {
    writeFileSync(
      join(dir, 'my_wf.js'),
      `export const meta = { name: 'my_wf', description: 'mine' }\nawait agent('x', { label: 'x' })\n`,
      'utf-8',
    );
    const cat = createWorkflowCatalog({ userDir: dir });
    expect(cat.remove('my_wf')).toBe(true);
    expect(cat.remove('audit_repo')).toBe(false);
    expect(cat.list().find((e) => e.name === 'audit_repo')?.source).toBe('builtin');
  });

  it('rejects invalid workflow names', () => {
    const cat = createWorkflowCatalog({ userDir: dir });
    expect(() => cat.load('NotSnake')).toThrow(/snake_case/);
    expect(() => cat.save('NotSnake', VALID_HEADER)).toThrow(/snake_case/);
  });

  it('rejects loading a file whose meta.name disagrees with filename', () => {
    writeFileSync(
      join(dir, 'mismatch.js'),
      `export const meta = { name: 'other_name', description: 'd' }\nawait agent('x', { label: 'x' })\n`,
      'utf-8',
    );
    const cat = createWorkflowCatalog({ userDir: dir });
    expect(() => cat.load('mismatch')).toThrow(/disagrees/);
  });

  it('parses every shipped built-in successfully', () => {
    const cat = createWorkflowCatalog({ userDir: dir });
    for (const entry of cat.list().filter((e) => e.source === 'builtin')) {
      // Should not throw — parseWorkflowScript runs inside .load
      expect(() => cat.load(entry.name)).not.toThrow();
    }
  });
});
