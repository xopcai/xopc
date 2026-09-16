import type { ConversationRoute } from '../../../routing/conversation-route.js';

export function decodeStoredWorkflowSubagent(key: string) {
  const match = /^agent:([^:]+):workflow:([^:]+):subagent:([^:]+)$/.exec(key);
  return match ? { agentId: match[1]!, runId: match[2]!, actorId: match[3]! } : null;
}

/** Frozen decoder for the one-time UUID cutover. Never import from runtime code. */
export function decodeStoredConversationKey(key: string, storedAgentId: string): ConversationRoute {
  if (key === 'heartbeat:main' || key.startsWith('heartbeat:isolated:')) {
    return { agentId: storedAgentId, scope: 'per-account-channel-peer', channel: 'heartbeat', accountId: 'default', peerKind: 'direct', peerId: key.slice(10), threadId: '', scopeId: '' };
  }
  const match = /^agent:([^:]+):(.+)$/.exec(key);
  const workflow = decodeStoredWorkflowSubagent(key);
  if (!match || (match[1] !== storedAgentId && workflow?.actorId !== storedAgentId)) throw new Error(`Unresolvable conversation owner: ${key}`);
  let rest = match[2]!;
  let scopeId = '';
  let threadId = '';
  const scopeAt = rest.lastIndexOf(':scope:');
  if (scopeAt >= 0) {
    scopeId = rest.slice(scopeAt + 7);
    rest = rest.slice(0, scopeAt);
  }
  const threadAt = rest.lastIndexOf(':thread:');
  if (threadAt >= 0) {
    threadId = rest.slice(threadAt + 8);
    rest = rest.slice(0, threadAt);
  }
  const route: ConversationRoute = {
    agentId: workflow?.agentId ?? storedAgentId, scope: 'main', channel: '', accountId: '',
    peerKind: 'direct', peerId: rest, threadId, scopeId,
  };
  const parts = rest.split(':');
  if (parts.length === 4 && parts[0] === 'workflow' && parts[2] === 'subagent') {
    return { ...route, scope: 'per-account-channel-peer', channel: 'workflow', accountId: 'default', peerId: `${parts[1]}/${parts[3]}` };
  }
  if (parts.length >= 4 && parts[2] === 'direct') {
    return { ...route, scope: 'per-account-channel-peer', channel: parts[0]!, accountId: parts[1]!, peerId: parts.slice(3).join(':') };
  }
  if (parts.length >= 3 && parts[1] === 'direct') {
    return { ...route, scope: 'per-channel-peer', channel: parts[0]!, peerId: parts.slice(2).join(':') };
  }
  if (parts.length >= 2 && parts[0] === 'direct') {
    return { ...route, scope: 'per-peer', peerId: parts.slice(1).join(':') };
  }
  if (parts.length >= 3 && (parts[1] === 'group' || parts[1] === 'channel')) {
    return { ...route, scope: 'group', channel: parts[0]!, peerKind: parts[1]!, peerId: parts.slice(2).join(':') };
  }
  return route;
}
