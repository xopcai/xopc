import { existsSync } from 'node:fs';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import type { Model, Api } from '@earendil-works/pi-ai';

import { createLogger } from '../../utils/logger.js';
import { guardSessionManager, type GuardedPiTranscriptManager } from './session-tool-result-guard-wrapper.js';
import { prepareSessionManagerForRun } from './session-manager-init.js';
import { prewarmSessionFile } from './session-manager-cache.js';
import { applyXopcProviderApiKey, createEmbeddedAuthStorage } from './xopc-auth-storage.js';
import { wrapStreamFnForXopcExtensions } from './xopc-stream-bridge.js';
import { xopcToolsToDefinitions } from './xopc-tools-bridge.js';
import { applySystemPromptOverrideToSession } from './system-prompt-override.js';

const log = createLogger('EmbeddedSessionRunner');

const DEFAULT_IDLE_TTL_MS = 5 * 60_000;

export type EmbeddedRunnerFingerprintInput = {
  sessionFile: string;
  workspaceDir: string;
  modelRef: string;
  toolNames: readonly string[];
  systemPrompt: string;
  thinkingLevel: string;
};

export function buildEmbeddedRunnerFingerprint(input: EmbeddedRunnerFingerprintInput): string {
  const tools = [...input.toolNames].sort().join('\0');
  const promptMarker = `${input.systemPrompt.length}:${input.systemPrompt.slice(0, 128)}`;
  return [
    input.sessionFile,
    input.workspaceDir,
    input.modelRef,
    tools,
    promptMarker,
    input.thinkingLevel,
  ].join('\u001f');
}

type PooledRunner = {
  sessionKey: string;
  fingerprint: string;
  session: AgentSession;
  piSm: GuardedPiTranscriptManager;
  settingsManager: SettingsManager;
  baseStreamFn: AgentSession['agent']['streamFn'];
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

export type AcquireEmbeddedSessionRunnerParams = {
  sessionKey: string;
  sessionId: string;
  sessionFile: string;
  sessionsDir: string;
  hadSessionFile: boolean;
  workspaceDir: string;
  model: Model<Api>;
  modelRef: string;
  tools: AgentTool[];
  systemPrompt: string;
  thinkingLevel: ThinkingLevel;
};

export type AcquiredEmbeddedSessionRunner = {
  session: AgentSession;
  piSm: GuardedPiTranscriptManager;
  reused: boolean;
  release: () => void;
};

const pool = new Map<string, PooledRunner>();

let stats = {
  acquires: 0,
  reuses: 0,
  creates: 0,
  evictions: 0,
};

export function isEmbeddedSessionRunnerEnabled(): boolean {
  const raw = process.env.XOPC_SESSION_RUNNER?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') {
    return false;
  }
  return true;
}

export function getEmbeddedSessionRunnerIdleTtlMs(): number {
  const raw = process.env.XOPC_SESSION_RUNNER_TTL_MS?.trim();
  if (!raw) {
    return DEFAULT_IDLE_TTL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_TTL_MS;
}

export function getEmbeddedSessionRunnerStats(): Readonly<typeof stats> & { pooled: number } {
  return { ...stats, pooled: pool.size };
}

export function resetEmbeddedSessionRunnerForTest(): void {
  for (const entry of pool.values()) {
    clearIdleTimer(entry);
  }
  pool.clear();
  stats = { acquires: 0, reuses: 0, creates: 0, evictions: 0 };
}

function clearIdleTimer(entry: PooledRunner): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

function scheduleIdleEviction(sessionKey: string, entry: PooledRunner): void {
  clearIdleTimer(entry);
  const ttlMs = getEmbeddedSessionRunnerIdleTtlMs();
  entry.idleTimer = setTimeout(() => {
    const current = pool.get(sessionKey);
    if (current === entry) {
      disposePooledRunner(sessionKey, entry, 'idle_ttl');
    }
  }, ttlMs);
  entry.idleTimer.unref?.();
}

function disposePooledRunner(sessionKey: string, entry: PooledRunner, reason: string): void {
  clearIdleTimer(entry);
  pool.delete(sessionKey);
  stats.evictions += 1;
  try {
    entry.piSm.flushPendingToolResults?.();
  } catch {
    /* ignore */
  }
  log.debug({ sessionKey, reason }, 'Embedded session runner evicted');
}

export function evictEmbeddedSessionRunner(sessionKey: string, reason = 'explicit'): void {
  const entry = pool.get(sessionKey);
  if (!entry) {
    return;
  }
  disposePooledRunner(sessionKey, entry, reason);
}

export function evictAllEmbeddedSessionRunners(reason = 'dispose_all'): void {
  for (const sessionKey of [...pool.keys()]) {
    evictEmbeddedSessionRunner(sessionKey, reason);
  }
}

function createEmbeddedSettingsManager(cwd: string): SettingsManager {
  const sm = SettingsManager.inMemory({ compaction: { enabled: false } });
  sm.setCompactionEnabled(false);
  void cwd;
  return sm;
}

async function createPooledRunner(params: AcquireEmbeddedSessionRunnerParams): Promise<PooledRunner> {
  const {
    sessionKey,
    sessionId,
    sessionFile,
    sessionsDir,
    hadSessionFile,
    workspaceDir,
    model,
    thinkingLevel,
    tools,
    systemPrompt,
  } = params;

  await prewarmSessionFile(sessionFile);
  const settingsManager = createEmbeddedSettingsManager(workspaceDir);

  const piSm = guardSessionManager(SessionManager.open(sessionFile, sessionsDir, workspaceDir), {
    sessionKey,
    contextWindowTokens: model.contextWindow ?? 128_000,
  });

  await prepareSessionManagerForRun({
    sessionManager: piSm,
    sessionFile,
    hadSessionFile,
    sessionId,
    cwd: workspaceDir,
  });

  const toolDefs = xopcToolsToDefinitions(tools);
  const toolNames = tools.map((t) => t.name);

  const authStorage = createEmbeddedAuthStorage();
  applyXopcProviderApiKey(authStorage, model.provider);

  const resourceLoader = new DefaultResourceLoader({
    cwd: workspaceDir,
    agentDir: getAgentDir(),
    settingsManager,
    noContextFiles: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: workspaceDir,
    model,
    thinkingLevel: thinkingLevel ?? 'medium',
    sessionManager: piSm,
    settingsManager,
    authStorage,
    resourceLoader,
    noTools: 'builtin',
    customTools: toolDefs,
    tools: toolNames,
  });

  applySystemPromptOverrideToSession(session, systemPrompt);
  const baseStreamFn = wrapStreamFnForXopcExtensions(session.agent.streamFn);
  session.agent.streamFn = baseStreamFn;

  const fingerprint = buildEmbeddedRunnerFingerprint({
    sessionFile,
    workspaceDir,
    modelRef: params.modelRef,
    toolNames,
    systemPrompt,
    thinkingLevel: thinkingLevel ?? 'medium',
  });

  return {
    sessionKey,
    fingerprint,
    session,
    piSm,
    settingsManager,
    baseStreamFn,
    lastUsedAt: Date.now(),
    idleTimer: null,
  };
}

export async function acquireEmbeddedSessionRunner(
  params: AcquireEmbeddedSessionRunnerParams,
): Promise<AcquiredEmbeddedSessionRunner> {
  stats.acquires += 1;

  const fingerprint = buildEmbeddedRunnerFingerprint({
    sessionFile: params.sessionFile,
    workspaceDir: params.workspaceDir,
    modelRef: params.modelRef,
    toolNames: params.tools.map((t) => t.name),
    systemPrompt: params.systemPrompt,
    thinkingLevel: params.thinkingLevel ?? 'medium',
  });

  const reuseEnabled = isEmbeddedSessionRunnerEnabled();
  const existing = pool.get(params.sessionKey);

  let entry: PooledRunner;
  let reused = false;

  if (reuseEnabled && existing && existing.fingerprint === fingerprint) {
    clearIdleTimer(existing);
    entry = existing;
    entry.lastUsedAt = Date.now();
    reused = true;
    stats.reuses += 1;
    applySystemPromptOverrideToSession(entry.session, params.systemPrompt);
    entry.session.agent.streamFn = entry.baseStreamFn;
    log.debug({ sessionKey: params.sessionKey }, 'Reusing pooled embedded session runner');
  } else {
    if (existing) {
      disposePooledRunner(params.sessionKey, existing, 'fingerprint_mismatch');
    }
    entry = await createPooledRunner(params);
    pool.set(params.sessionKey, entry);
    stats.creates += 1;
    log.debug({ sessionKey: params.sessionKey }, 'Created embedded session runner');
  }

  return {
    session: entry.session,
    piSm: entry.piSm,
    reused,
    release: () => {
      if (!isEmbeddedSessionRunnerEnabled()) {
        disposePooledRunner(params.sessionKey, entry, 'runner_disabled');
        return;
      }
      entry.lastUsedAt = Date.now();
      scheduleIdleEviction(params.sessionKey, entry);
    },
  };
}

/** Resolve transcript path inputs used by both runner acquire and turn execution. */
export async function resolveEmbeddedTranscriptInputs(
  sessionStore: import('../../session/store.js').SessionStore,
  sessionKey: string,
): Promise<{
  sessionId: string;
  sessionFile: string;
  sessionsDir: string;
  hadSessionFile: boolean;
}> {
  const { sessionId, absPath: sessionFile, sessionsDir } = await sessionStore.resolveTranscriptPath(sessionKey);
  return {
    sessionId,
    sessionFile,
    sessionsDir,
    hadSessionFile: existsSync(sessionFile),
  };
}
