import { parseSessionKey } from '../../routing/session-key.js';
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

function stateKey(sessionKey: string, turnId: string): string {
  return `${sessionKey}\u0000${turnId}`;
}

export function resolveMemorySessionKind(sessionKey: string): MemorySessionKind {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return 'unknown';
  if (parsed.agentId === 'subagent' || sessionKey.includes(':subagent:')) return 'subagent';
  if (parsed.source === 'cron') return 'automation';
  if (sessionKey.includes(':workflow:') || parsed.scopeId?.startsWith('workflow')) return 'workflow';
  if (parsed.peerKind === 'group' || parsed.peerKind === 'channel') return 'group';
  return 'interactive';
}

export function markTurnToolResult(sessionKey: string, turnId: string, toolName: string): void {
  const key = stateKey(sessionKey, turnId);
  const state = turnStates.get(key) ?? { toolNames: new Set<string>(), recalled: false, automaticRecall: false };
  state.toolNames.add(toolName);
  state.recalled ||= RECALL_TOOL_RE.test(toolName);
  turnStates.set(key, state);
  if (turnStates.size > MAX_TRACKED_TURNS) {
    turnStates.delete(turnStates.keys().next().value as string);
  }
}

export function markTurnRecalledContext(sessionKey: string, turnId: string): void {
  const key = stateKey(sessionKey, turnId);
  const state = turnStates.get(key) ?? { toolNames: new Set<string>(), recalled: false, automaticRecall: false };
  state.recalled = true;
  state.automaticRecall = true;
  turnStates.set(key, state);
}

export function consumeTurnMemoryProvenance(
  sessionKey: string,
  turnId: string,
): TurnMemoryProvenance {
  const key = stateKey(sessionKey, turnId);
  const state = turnStates.get(key);
  turnStates.delete(key);
  const toolNames = [...(state?.toolNames ?? [])].sort();
  return {
    originClass: toolNames.length > 0 ? 'untrusted' : 'agent',
    sessionKind: resolveMemorySessionKind(sessionKey),
    sourceSessionId: sessionKey,
    sourceTurnId: turnId,
    derivedFromRecalledContext: state?.recalled ?? false,
    taintReasons: [
      ...toolNames.map((name) => `tool:${name}`),
      ...(state?.automaticRecall ? ['recall:automatic'] : []),
    ],
  };
}

export function clearTurnMemoryProvenance(sessionKey: string, turnId: string): void {
  turnStates.delete(stateKey(sessionKey, turnId));
}
