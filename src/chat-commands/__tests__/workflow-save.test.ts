/**
 * `/workflow save <name>` integration test.
 *
 * The handler reads from {@link getLastWorkflowMemory} (in-memory singleton)
 * and writes to a {@link createWorkflowCatalog} pointing at the default
 * `~/.xopc/workflows/` dir. We isolate both by stubbing `XOPC_STATE_DIR` to a
 * tmp dir and clearing the singleton between cases.
 */

import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workflowCommand } from '../builtins/workflow.js';
import type { CommandContext } from '../types.js';
import {
  _resetLastWorkflowMemoryForTests,
  getLastWorkflowMemory,
} from '../../agent/workflow/last-run-memory.js';

const VALID_SCRIPT = `export const meta = { name: 'demo', description: 'demo workflow' }\nawait agent('hi', { label: 'hi' })\n`;

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    sessionKey: 'main:cli:default:dm:42',
    ...overrides,
  } as unknown as CommandContext;
}

describe('/workflow save', () => {
  let stateDir: string;
  let prevStateDir: string | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-wf-save-'));
    prevStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = stateDir;
    _resetLastWorkflowMemoryForTests();
  });

  afterEach(() => {
    if (prevStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = prevStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('errors without a target name', async () => {
    const res = await workflowCommand.handler(ctx(), 'save');
    expect(res?.success).toBe(false);
    expect(res?.content).toMatch(/usage/i);
  });

  it('errors when no workflow has run yet in this session', async () => {
    const res = await workflowCommand.handler(ctx(), 'save my_wf');
    expect(res?.success).toBe(false);
    expect(res?.content).toMatch(/No workflow has run/);
  });

  it('saves the recorded script when meta.name matches the target', async () => {
    getLastWorkflowMemory().record('main:cli:default:dm:42', {
      script: VALID_SCRIPT,
      metaName: 'demo',
      source: 'script',
      recordedAt: 1,
    });

    const res = await workflowCommand.handler(ctx(), 'save demo');
    expect(res?.success).toBe(true);
    expect(res?.content).toMatch(/Saved workflow \*\*demo\*\*/);

    const filePath = join(stateDir, 'workflows', 'demo.js');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toContain("name: 'demo'");
  });

  it("rewrites meta.name when the user saves under a different name", async () => {
    getLastWorkflowMemory().record('main:cli:default:dm:42', {
      script: VALID_SCRIPT,
      metaName: 'demo',
      source: 'script',
      recordedAt: 1,
    });

    const res = await workflowCommand.handler(ctx(), 'save renamed_demo');
    expect(res?.success).toBe(true);

    const filePath = join(stateDir, 'workflows', 'renamed_demo.js');
    expect(existsSync(filePath)).toBe(true);
    const written = readFileSync(filePath, 'utf-8');
    expect(written).toContain("name: 'renamed_demo'");
    expect(written).not.toContain("name: 'demo'");
  });

  it('refuses non-snake-case save names', async () => {
    getLastWorkflowMemory().record('main:cli:default:dm:42', {
      script: VALID_SCRIPT,
      metaName: 'demo',
      source: 'script',
      recordedAt: 1,
    });

    const res = await workflowCommand.handler(ctx(), 'save NotSnake');
    expect(res?.success).toBe(false);
    expect(res?.content).toMatch(/snake_case/);
  });

  it('does not see another session\'s recorded workflow', async () => {
    getLastWorkflowMemory().record('main:cli:default:dm:OTHER', {
      script: VALID_SCRIPT,
      metaName: 'demo',
      source: 'script',
      recordedAt: 1,
    });

    const res = await workflowCommand.handler(ctx(), 'save demo');
    expect(res?.success).toBe(false);
    expect(res?.content).toMatch(/No workflow has run/);
  });
});
