import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { fileReferenceRegistry } from '../file-reference-registry.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

const TOKEN = 'import-test-token';
const SESSION_KEY = 'agent:main:webchat:default:direct:chat_test';

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function buildConfig(workspaceRoot: string): Partial<Config> {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    agents: {
      default: 'main',
      defaultPreset: 'default',
      capabilityPresets: {
        default: {
          id: 'default',
          name: 'Global defaults',
          models: { defaultRole: 'deep', roles: { deep: { model: 'test/test-model' } } },
        },
      },
      list: [
        {
          id: 'main',
          identity: { name: 'Main', role: 'General assistant' },
          responsibilities: { primary: ['Help the user complete tasks'] },
          workspace: { root: workspaceRoot },
          tools: { builtin: {} },
          skills: { mode: 'all' },
          workflows: {},
          boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
        },
      ],
    },
  } as Partial<Config>;
}

function createMockService(cfg: Partial<Config>, workspaceRoot: string): GatewayService {
  return {
    currentConfig: cfg,
    getAuthToken: () => TOKEN,
    getAuthMode: () => 'token',
    getResolvedAuth: () => ({ mode: 'token', token: TOKEN }),
    emit: () => {},
    getEffectiveWorkspacePathForSession: async () => workspaceRoot,
    getHealth: () => ({ status: 'healthy', version: 'test', channels: [], uptime: 0 }),
    getChannelsStatus: () => [],
    sessionManagerInstance: {} as GatewayService['sessionManagerInstance'],
    listSessions: async () => ({ items: [], total: 0 }),
    getSession: async () => null,
    reloadConfig: async () => ({ success: true }),
    saveConfig: async () => ({ saved: true }),
    refreshAuthToken: async () => 'new-token',
    getSkillsApi: () => [],
    reloadSkillsFromDisk: () => {},
    installManagedSkillZip: () => ({ success: true }),
    deleteManagedSkill: () => {},
    getExtensionLoader: () => null,
  } as unknown as GatewayService;
}

describe('POST /api/workspace/import-file-ref/:id', () => {
  let parentDir: string;
  let workspaceRoot: string;
  let outsideDir: string;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'xopc-import-routes-'));
    workspaceRoot = join(parentDir, 'main');
    mkdirSync(workspaceRoot, { recursive: true });
    outsideDir = mkdtempSync(join(tmpdir(), 'xopc-import-source-'));
  });

  afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  function newApp() {
    const cfg = buildConfig(workspaceRoot);
    const service = createMockService(cfg, workspaceRoot);
    return createHonoApp({ service, token: TOKEN });
  }

  function registerSourceFile(opts: {
    name?: string;
    bytes?: Buffer | string;
    sessionKey?: string;
    capabilities?: Array<
      'preview' | 'edit' | 'openExternal' | 'revealInFolder' | 'copyPath' | 'importToWorkspace'
    >;
  } = {}) {
    const name = opts.name ?? 'note.txt';
    const abs = join(outsideDir, name);
    writeFileSync(abs, opts.bytes ?? 'hello world');
    const ref = fileReferenceRegistry.register({
      absolutePath: abs,
      sessionKey: opts.sessionKey,
      scope: 'external',
      locationKind: 'host',
      capabilities: opts.capabilities ?? ['openExternal', 'revealInFolder', 'copyPath', 'importToWorkspace'],
    });
    return { id: ref.id, abs };
  }

  it('imports a host file into imports/<basename> (happy path)', async () => {
    const { id, abs } = registerSourceFile({ bytes: 'payload-A' });
    const app = newApp();

    const res = await app.request(`/api/workspace/import-file-ref/${id}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      payload: {
        workspaceRelativePath: string;
        absolutePath: string;
        bytesCopied: number;
        renamed: boolean;
        overwrote: boolean;
        newFileRefId: string;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.payload.workspaceRelativePath).toBe('imports/note.txt');
    expect(body.payload.absolutePath).toBe(join(workspaceRoot, 'imports', 'note.txt'));
    expect(body.payload.bytesCopied).toBe('payload-A'.length);
    expect(body.payload.renamed).toBe(false);
    expect(body.payload.overwrote).toBe(false);
    expect(readFileSync(body.payload.absolutePath, 'utf-8')).toBe('payload-A');
    // Source untouched
    expect(readFileSync(abs, 'utf-8')).toBe('payload-A');
    // Source ref consumed; new ref valid
    expect(fileReferenceRegistry.resolve(id)).toBeNull();
    expect(fileReferenceRegistry.resolve(body.payload.newFileRefId)?.scope).toBe('workspace');
  });

  it('rejects when capability missing', async () => {
    const { id } = registerSourceFile({
      capabilities: ['openExternal', 'revealInFolder', 'copyPath'],
    });
    const res = await newApp().request(`/api/workspace/import-file-ref/${id}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IMPORT_NOT_ALLOWED');
  });

  it('rejects when sessionKey does not match the ref', async () => {
    const { id } = registerSourceFile({ sessionKey: SESSION_KEY });
    const res = await newApp().request(`/api/workspace/import-file-ref/${id}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FILE_REF_FORBIDDEN');
  });

  it('returns 404 when the source file was deleted between resolve and import', async () => {
    const { id, abs } = registerSourceFile();
    rmSync(abs);
    const res = await newApp().request(`/api/workspace/import-file-ref/${id}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SOURCE_NOT_FOUND');
    // Stale ref should be consumed to prevent retry loops
    expect(fileReferenceRegistry.resolve(id)).toBeNull();
  });

  it('returns 413 when source exceeds maxBytes', async () => {
    // 2 KiB source with maxBytes=1024 in cfg.
    const cfg: Partial<Config> = {
      ...buildConfig(workspaceRoot),
      workspace: { import: { targetDir: 'imports', maxBytes: 1024, allowOverwrite: true } },
    } as Partial<Config>;
    const service = createMockService(cfg, workspaceRoot);
    const app = createHonoApp({ service, token: TOKEN });

    const abs = join(outsideDir, 'big.bin');
    writeFileSync(abs, Buffer.alloc(2048));
    const ref = fileReferenceRegistry.register({
      absolutePath: abs,
      scope: 'external',
      locationKind: 'host',
      capabilities: ['openExternal', 'revealInFolder', 'copyPath', 'importToWorkspace'],
    });

    const res = await app.request(`/api/workspace/import-file-ref/${ref.id}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SOURCE_TOO_LARGE');
  });

  it('blocks destination paths that hit the write-policy guard (.env)', async () => {
    const { id } = registerSourceFile({ name: 'secrets.txt' });
    const res = await newApp().request(`/api/workspace/import-file-ref/${id}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ destination: '.env' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DESTINATION_BLOCKED');
  });

  it('renames on conflict (second import → imports/note-2.txt)', async () => {
    const { id: idA } = registerSourceFile({ bytes: 'first' });
    const res1 = await newApp().request(`/api/workspace/import-file-ref/${idA}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { payload: { workspaceRelativePath: string } };
    expect(body1.payload.workspaceRelativePath).toBe('imports/note.txt');

    // Re-register a fresh ref pointing at a new source with the same basename.
    const { id: idB } = registerSourceFile({ bytes: 'second' });
    const res2 = await newApp().request(`/api/workspace/import-file-ref/${idB}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      payload: { workspaceRelativePath: string; renamed: boolean };
    };
    expect(body2.payload.workspaceRelativePath).toBe('imports/note-2.txt');
    expect(body2.payload.renamed).toBe(true);
    expect(readFileSync(join(workspaceRoot, 'imports', 'note.txt'), 'utf-8')).toBe('first');
    expect(readFileSync(join(workspaceRoot, 'imports', 'note-2.txt'), 'utf-8')).toBe('second');
  });

  it('rejects when source is a directory', async () => {
    const dirAbs = join(outsideDir, 'a-dir');
    mkdirSync(dirAbs);
    const ref = fileReferenceRegistry.register({
      absolutePath: dirAbs,
      scope: 'external',
      locationKind: 'host',
      capabilities: ['openExternal', 'revealInFolder', 'copyPath', 'importToWorkspace'],
    });
    const res = await newApp().request(`/api/workspace/import-file-ref/${ref.id}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SOURCE_NOT_FILE');
  });

  it('returns 404 for an unknown / expired file ref id', async () => {
    const res = await newApp().request('/api/workspace/import-file-ref/00000000-0000-0000-0000-000000000000', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FILE_REF_EXPIRED');
  });

  it('requires auth', async () => {
    const { id } = registerSourceFile();
    const res = await newApp().request(`/api/workspace/import-file-ref/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    // Ref still alive since we never reached the handler body
    expect(fileReferenceRegistry.resolve(id)).not.toBeNull();
  });
});
