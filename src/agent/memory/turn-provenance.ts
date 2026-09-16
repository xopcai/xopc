import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { getConversationRouting } from '../../routing/session-key.js';
import type { MemoryOriginClass, MemorySessionKind } from './types.js';

export interface TurnMemoryProvenance {
  originClass: MemoryOriginClass;
  sessionKind: MemorySessionKind;
  sourceSessionId: string;
  sourceTurnId: string;
  derivedFromRecalledContext: boolean;
  taintReasons: string[];
}

type MutableTurnState = {
  toolNames: Set<string>;
  recalled: boolean;
  automaticRecall: boolean;
};

const turnStates = new Map<string, MutableTurnState>();
const RECALL_TOOL_RE = /^(?:memory_(?:search|get)|session_(?:search|recall))$/;
const MAX_TRACKED_TURNS = 1_000;

function stateKey(conversationId: string, turnId: string): string {
  return `${conversationId}\u0000${turnId}`;
}

export function resolveMemorySessionKind(conversationId: string): MemorySessionKind {
  const parsed = getConversationRouting(conversationId);
  if (!parsed) return 'unknown';
  const kind = getSessionMetadata(conversationId)?.sessionType;
  if (kind === 'workflow-subagent') return 'subagent';
  if (parsed.source === 'cron') return 'automation';
  if (kind === 'workflow-run') return 'workflow';
  if (parsed.peerKind === 'group' || parsed.peerKind === 'channel') return 'group';
  return 'interactive';
}

export function markTurnToolResult(conversationId: string, turnId: string, toolName: string): void {
  const key = stateKey(conversationId, turnId);
  const state = turnStates.get(key) ?? { toolNames: new Set<string>(), recalled: false, automaticRecall: false };
  state.toolNames.add(toolName);
  state.recalled ||= RECALL_TOOL_RE.test(toolName);
  turnStates.set(key, state);
  if (turnStates.size > MAX_TRACKED_TURNS) {
    turnStates.delete(turnStates.keys().next().value as string);
  }
}

export function markTurnRecalledContext(conversationId: string, turnId: string): void {
  const key = stateKey(conversationId, turnId);
  const state = turnStates.get(key) ?? { toolNames: new Set<string>(), recalled: false, automaticRecall: false };
  state.recalled = true;
  state.automaticRecall = true;
  turnStates.set(key, state);
}

export function consumeTurnMemoryProvenance(
  conversationId: string,
  turnId: string,
): TurnMemoryProvenance {
  const key = stateKey(conversationId, turnId);
  const state = turnStates.get(key);
  turnStates.delete(key);
  const toolNames = [...(state?.toolNames ?? [])].sort();
  return {
    originClass: toolNames.length > 0 ? 'untrusted' : 'agent',
    sessionKind: resolveMemorySessionKind(conversationId),
    sourceSessionId: conversationId,
    sourceTurnId: turnId,
    derivedFromRecalledContext: state?.recalled ?? false,
    taintReasons: [
      ...toolNames.map((name) => `tool:${name}`),
      ...(state?.automaticRecall ? ['recall:automatic'] : []),
    ],
  };
}

export function clearTurnMemoryProvenance(conversationId: string, turnId: string): void {
  turnStates.delete(stateKey(conversationId, turnId));
}
