import { realpath } from 'node:fs/promises';

import { getExecutionEnvironmentForSession } from '../../execution-environments/subject.js';
import { getProjectForSession } from '../../projects/workspace.js';
import { projectWorkspacePath } from '../../session/session-workspace.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import type { CompactionResult } from '../memory/compaction.js';
import { getExternalAgentDriver } from './registry.js';
import {
  bindExternalSession,
  clearExternalSessionLastInputEntry,
  getExternalConversationAgent,
  readExternalSessionBinding,
} from './session-binding.js';

async function resolveExternalSessionContext(conversationId: string) {
  const agent = getExternalConversationAgent(conversationId);
  if (!agent) return null;
  const driver = getExternalAgentDriver(agent.execution.kind);
  const transcriptId = readCurrentTranscriptId(getSqliteDatabase(), conversationId)?.trim();
  if (!transcriptId) {
    throw new Error(`Session "${conversationId}" has no active transcript.`);
  }
  const project = getProjectForSession(conversationId);
  const workspace = project && (getExecutionEnvironmentForSession(conversationId)?.rootPath ?? projectWorkspacePath(project));
  if (!workspace) {
    throw new Error(`${driver.label} session has no project workspace.`);
  }
  const cwd = await realpath(workspace);
  const identity = {
    conversationId,
    transcriptId,
    runtimeKind: agent.execution.kind,
    agentId: agent.id,
    cwd,
  };
  const binding = readExternalSessionBinding(identity);
  return { agent, driver, identity, binding };
}

/** Compact an external runtime's native conversation context (e.g. Codex `thread/compact/start`). */
export async function compactExternalSession(
  conversationId: string,
  signal?: AbortSignal,
): Promise<CompactionResult> {
  const resolved = await resolveExternalSessionContext(conversationId);
  if (!resolved) {
    throw new Error('Conversation is not bound to an external runtime agent.');
  }
  const { agent, driver, identity, binding } = resolved;
  if (!driver.compactSession) {
    return {
      compacted: false,
      summary: `${driver.label} manages context compaction automatically.`,
      firstKeptIndex: 0,
      tokensBefore: 0,
      tokensAfter: 0,
      messages: [],
    };
  }
  if (!binding) {
    return {
      compacted: false,
      summary: `No active ${driver.label} thread exists yet to compact.`,
      firstKeptIndex: 0,
      tokensBefore: 0,
      tokensAfter: 0,
      messages: [],
    };
  }
  const result = await driver.compactSession({
    conversationId,
    execution: agent.execution,
    cwd: identity.cwd,
    nativeSessionId: binding.nativeSessionId,
    instructions: agent.profile?.instructions,
    signal,
  });
  return {
    compacted: result.compacted,
    summary: result.summary ?? `${driver.label} context compacted.`,
    firstKeptIndex: 0,
    tokensBefore: 0,
    tokensAfter: 0,
    messages: [],
  };
}

/** Fork an external runtime's native thread and bind the newly created xopc conversation to it. */
export async function forkExternalSession(input: {
  sourceConversationId: string;
  targetConversationId: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  const resolved = await resolveExternalSessionContext(input.sourceConversationId);
  if (!resolved) return false;
  const { agent, driver, identity, binding } = resolved;
  if (!driver.forkSession) {
    throw new Error(`${driver.label} sessions do not support forking.`);
  }
  if (!binding) return true;
  const targetTranscriptId = readCurrentTranscriptId(getSqliteDatabase(), input.targetConversationId)?.trim();
  if (!targetTranscriptId) {
    throw new Error(`Forked session "${input.targetConversationId}" has no active transcript.`);
  }
  const forked = await driver.forkSession({
    conversationId: input.sourceConversationId,
    execution: agent.execution,
    cwd: identity.cwd,
    nativeSessionId: binding.nativeSessionId,
    instructions: agent.profile?.instructions,
    signal: input.signal,
  });
  if (!forked) {
    throw new Error(`${driver.label} runtime does not support forking this session.`);
  }
  bindExternalSession(
    {
      conversationId: input.targetConversationId,
      transcriptId: targetTranscriptId,
      runtimeKind: agent.execution.kind,
      agentId: agent.id,
      cwd: identity.cwd,
    },
    {
      nativeSessionId: forked.nativeSessionId,
      inputEntryId: null,
      resumeCursor: forked.resumeCursor,
    },
  );
  return true;
}

/** Roll back trailing turns in an external runtime's native thread (e.g. Codex `thread/rollback`). */
export async function rollbackExternalSession(
  conversationId: string,
  numTurns: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const resolved = await resolveExternalSessionContext(conversationId);
  if (!resolved) return false;
  const { agent, driver, identity, binding } = resolved;
  if (!driver.rollbackSession) {
    throw new Error(`${driver.label} sessions do not support rolling back turns.`);
  }
  if (!binding) return true;
  await driver.rollbackSession({
    conversationId,
    execution: agent.execution,
    cwd: identity.cwd,
    nativeSessionId: binding.nativeSessionId,
    instructions: agent.profile?.instructions,
    numTurns: Math.max(1, Math.trunc(numTurns)),
    signal,
  });
  clearExternalSessionLastInputEntry(identity.transcriptId);
  return true;
}
