import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getSetupHandler, listSetupHandlers } from '../handlers.js';

// Importing the command modules registers their handlers (and CLI commands)
// as a side effect. We don't invoke the CLI here — we only need the handler
// table populated.
import '../../voice.js';
import '../../search.js';

describe('setup handler registry (M3.5 phase A)', () => {
  const cleanup: string[] = [];

  afterEach(() => {
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
    cleanup.length = 0;
  });

  function tempConfig(initial: object = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-handlers-'));
    cleanup.push(dir);
    const path = join(dir, 'xopc.json');
    writeFileSync(path, JSON.stringify(initial, null, 2));
    return path;
  }

  it('voice and search domains both expose enable/disable/add/remove handlers', () => {
    const ids = listSetupHandlers().map((h) => `${h.domain}/${h.action}`);
    expect(ids).toContain('voice/enable');
    expect(ids).toContain('voice/disable');
    expect(ids).toContain('search/add');
    expect(ids).toContain('search/remove');
  });

  it('returns undefined for unknown handler keys', () => {
    expect(getSetupHandler('voice', 'erase')).toBeUndefined();
    expect(getSetupHandler('imaginary', 'add')).toBeUndefined();
  });

  it('voice/enable handler writes cfg.messages.tts and reports changed paths', async () => {
    const configPath = tempConfig({});
    const entry = getSetupHandler('voice', 'enable');
    expect(entry).toBeDefined();

    const outcome = await entry!.handler({
      configPath,
      fields: { provider: 'edge', trigger: 'inbound' },
      options: { dryRun: false, json: true },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('set');
    expect(outcome.changedPaths.some((p) => p.startsWith('messages'))).toBe(true);

    const saved = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(saved.messages.tts).toMatchObject({
      enabled: true,
      provider: 'edge',
      trigger: 'inbound',
    });
  });

  it('voice/enable in dryRun mode does not modify the file', async () => {
    const configPath = tempConfig({});
    const before = readFileSync(configPath, 'utf8');
    const entry = getSetupHandler('voice', 'enable')!;

    const outcome = await entry.handler({
      configPath,
      fields: { provider: 'edge' },
      options: { dryRun: true, json: true },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.dryRun).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('search/add rejects searxng without --url and surfaces a structured error', async () => {
    const configPath = tempConfig({});
    const entry = getSetupHandler('search', 'add')!;

    const outcome = await entry.handler({
      configPath,
      fields: { type: 'searxng' },
      options: { dryRun: true, json: true },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errors?.[0]?.path).toBe('url');
  });

  it('search/add rejects unknown provider type with a clear message', async () => {
    const configPath = tempConfig({});
    const entry = getSetupHandler('search', 'add')!;

    const outcome = await entry.handler({
      configPath,
      fields: { type: 'kagi', key: 'k1' },
      options: { dryRun: true, json: true },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errors?.[0]?.message).toMatch(/Unknown search type/);
  });

  it('search/add then search/remove are idempotent and round-trip cleanly', async () => {
    const configPath = tempConfig({});

    const addOutcome = await getSetupHandler('search', 'add')!.handler({
      configPath,
      fields: { type: 'brave', key: 'brv-test' },
      options: { dryRun: false, json: true },
    });
    expect(addOutcome.ok).toBe(true);

    // Re-running with the same value is a noop diff.
    const noopOutcome = await getSetupHandler('search', 'add')!.handler({
      configPath,
      fields: { type: 'brave', key: 'brv-test' },
      options: { dryRun: false, json: true },
    });
    expect(noopOutcome.ok).toBe(true);
    expect(noopOutcome.action).toBe('noop');

    const removeOutcome = await getSetupHandler('search', 'remove')!.handler({
      configPath,
      fields: { type: 'brave' },
      options: { dryRun: false, json: true },
    });
    expect(removeOutcome.ok).toBe(true);
    expect(removeOutcome.action).toBe('remove');

    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(cfg.tools?.web?.search?.providers ?? []).toHaveLength(0);
  });
});
