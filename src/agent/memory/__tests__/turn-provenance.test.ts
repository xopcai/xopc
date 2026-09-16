import { requireXopcDatabase as openFixtureDatabase } from '../../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("6d9217fe-77c7-411d-8cc9-92aabe81a2d0", '', {"agentId":"main","sourceChannel":"main","sourceChatId":"","sessionType":"chat","routing":{"agentId":"main","source":"main","accountId":"default","peerKind":"direct","peerId":""}});
  ensureFixtureConversation("78198daf-8200-4ee5-891a-cc6c3c7c078c", '', {"agentId":"main","sourceChannel":"cron","sourceChatId":"daily-review","sessionType":"cron","routing":{"agentId":"main","source":"cron","accountId":"default","peerKind":"direct","peerId":"daily-review"}});
  ensureFixtureConversation("b46b6ae8-d3ae-47f1-818b-93034675181d", '', {"agentId":"main","sourceChannel":"subagent","sourceChatId":"main","sessionType":"workflow-subagent","routing":{"agentId":"main","source":"subagent","accountId":"default","peerKind":"direct","peerId":"main"}});
  ensureFixtureConversation("bb151cc5-73d2-441c-8f60-ef3984388677", '', {"agentId":"main","sourceChannel":"telegram","sourceChatId":"team","sessionType":"chat","routing":{"agentId":"main","source":"telegram","accountId":"default","peerKind":"group","peerId":"team"}});
}
import { describe, expect, it } from 'vitest';

import {
  consumeTurnMemoryProvenance,
  markTurnToolResult,
  resolveMemorySessionKind,
} from '../turn-provenance.js';

describe('turn memory provenance', () => {
  it('keeps a tool-free interactive turn agent-trusted', () => {
    seedConversationFixtures();
    expect(consumeTurnMemoryProvenance("6d9217fe-77c7-411d-8cc9-92aabe81a2d0", 'turn-clean')).toMatchObject({
      originClass: 'agent',
      sessionKind: 'interactive',
      derivedFromRecalledContext: false,
      taintReasons: [],
    });
  });

  it('taints tool-assisted turns and identifies recalled context', () => {
    seedConversationFixtures();
    markTurnToolResult("6d9217fe-77c7-411d-8cc9-92aabe81a2d0", 'turn-tool', 'exec_command');
    markTurnToolResult("6d9217fe-77c7-411d-8cc9-92aabe81a2d0", 'turn-tool', 'memory_search');

    expect(consumeTurnMemoryProvenance("6d9217fe-77c7-411d-8cc9-92aabe81a2d0", 'turn-tool')).toMatchObject({
      originClass: 'untrusted',
      derivedFromRecalledContext: true,
      taintReasons: ['tool:exec_command', 'tool:memory_search'],
    });
  });

  it('classifies non-interactive session kinds structurally', () => {
    seedConversationFixtures();
    expect(resolveMemorySessionKind("78198daf-8200-4ee5-891a-cc6c3c7c078c")).toBe('automation');
    expect(resolveMemorySessionKind("b46b6ae8-d3ae-47f1-818b-93034675181d")).toBe('subagent');
    expect(resolveMemorySessionKind("bb151cc5-73d2-441c-8f60-ef3984388677")).toBe('group');
  });
});
