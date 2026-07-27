import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceModule = (path: string) =>
  pathToFileURL(join(process.cwd(), path)).href;

function runtime(callTool: (...args: unknown[]) => Promise<unknown>) {
  const status = {
    state: 'ready',
    workspace: process.cwd(),
    project: 'hidden-eval',
    indexedAt: new Date(0).toISOString(),
    dirtyPaths: [],
    coverage: 'complete',
  };
  return {
    prime() {},
    markDirty() {},
    supportsTool: () => true,
    callTool,
    getStatus: () => status,
    dispose() {},
  };
}

async function binaryPrecedence(): Promise<void> {
  const { resolveCodebaseMemoryBinary } = await import(
    sourceModule('src/agent/code-intelligence/binary.ts')
  );
  const root = await mkdtemp(join(tmpdir(), 'xopc-eval-binary-'));
  const explicit = join(root, 'explicit');
  const environment = join(root, 'environment');
  await Promise.all([
    writeFile(explicit, '#!/bin/sh\nexit 0\n'),
    writeFile(environment, '#!/bin/sh\nexit 0\n'),
  ]);
  await Promise.all([chmod(explicit, 0o755), chmod(environment, 0o755)]);
  process.env.XOPC_CBM_BINARY = environment;
  assert.equal(resolveCodebaseMemoryBinary(explicit), await realpath(explicit));
}

async function traceDirection(): Promise<void> {
  const { createCodeIntelligenceTools } = await import(
    sourceModule('src/agent/code-intelligence/tools.ts')
  );
  let received: Record<string, unknown> | undefined;
  const rt = runtime(async (_tool, args) => {
    received = args as Record<string, unknown>;
    return { text: 'ok', status: rt.getStatus() };
  });
  const tool = createCodeIntelligenceTools({ getRuntime: () => rt })
    .find((candidate) => candidate.name === 'code_trace');
  assert.ok(tool);
  await tool.execute('hidden-trace', {
    functionName: 'runTurn',
    direction: 'inbound',
  } as never);
  assert.equal(received?.direction, 'inbound');
}

async function impactCount(): Promise<void> {
  const { createCodeIntelligenceTools } = await import(
    sourceModule('src/agent/code-intelligence/tools.ts')
  );
  const rt = runtime(async () => ({
    text: JSON.stringify({
      changed_files: ['src/a.ts', 'src/a.ts'],
      changed_count: 2,
      impacted_symbols: [],
    }),
    status: rt.getStatus(),
  }));
  const tool = createCodeIntelligenceTools({ getRuntime: () => rt })
    .find((candidate) => candidate.name === 'code_impact');
  assert.ok(tool);
  const result = await tool.execute('hidden-impact', {} as never);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /"changed_count":1/);
}

async function perAgentGating(): Promise<void> {
  const { isCodeIntelligenceEnabledForAgent } = await import(
    sourceModule('src/agent/code-intelligence/tool-gating.ts')
  );
  const config = {
    enabled: true,
    agentIds: ['coder'],
  };
  assert.equal(isCodeIntelligenceEnabledForAgent(config, 'coder'), true);
  assert.equal(isCodeIntelligenceEnabledForAgent(config, 'other'), false);
  assert.equal(isCodeIntelligenceEnabledForAgent({ ...config, enabled: false }, 'coder'), false);
  assert.equal(isCodeIntelligenceEnabledForAgent(config, undefined), false);
}

async function workspaceInvalidation(): Promise<void> {
  const { SessionConfigService } = await import(
    sourceModule('src/agent/session/session-config-service.ts')
  );
  const workspace = await mkdtemp(join(tmpdir(), 'xopc-eval-workspace-'));
  const calls: string[] = [];
  const service = new SessionConfigService({
    sessionStore: { load: async () => [] } as never,
    sessionConfigStore: {
      get: async () => undefined,
      update: async () => {},
    } as never,
    modelManager: {} as never,
    agentManager: {
      setSessionWorkspaceOverride: () => {},
      removeAgent: (sessionKey: string) => calls.push(sessionKey),
    } as never,
    getConfig: () => ({}) as never,
  });
  const result = await (
    service as unknown as {
      patchWorkingDirectory: (
        sessionKey: string,
        workingDirectory: string,
      ) => Promise<{ ok: boolean }>;
    }
  ).patchWorkingDirectory('agent:coder:eval:hidden', workspace);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ['agent:coder:eval:hidden']);
}

export const checks: Record<string, () => Promise<void>> = {
  'binary-precedence': binaryPrecedence,
  'trace-direction': traceDirection,
  'impact-count': impactCount,
  'per-agent-gating': perAgentGating,
  'workspace-invalidation': workspaceInvalidation,
};

export async function runHiddenCheck(selected: string | undefined): Promise<void> {
  const check = selected ? checks[selected] : undefined;
  if (!check) throw new Error(`Unknown hidden check: ${selected ?? '<missing>'}`);
  await check();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runHiddenCheck(process.argv[2]);
}
