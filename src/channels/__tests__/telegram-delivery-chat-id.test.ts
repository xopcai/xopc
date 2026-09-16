import { requireXopcDatabase as openFixtureDatabase } from '../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("ea56d808-18f3-44f3-8144-29030e98fac0", '', {"agentId":"main","sourceChannel":"telegram","sourceChatId":"916534770","sessionType":"chat","routing":{"agentId":"main","source":"telegram","accountId":"default","peerKind":"direct","peerId":"916534770"}});
}
import { describe, it, expect } from 'vitest';
import { normalizeTelegramDeliveryChatId } from '../telegram/index.js';

describe('normalizeTelegramDeliveryChatId', () => {
  it('passes through plain numeric chat id', () => {
    seedConversationFixtures();
    expect(normalizeTelegramDeliveryChatId('916534770')).toBe('916534770');
  });

  it('strips full telegram session key to peer id', () => {
    seedConversationFixtures();
    expect(normalizeTelegramDeliveryChatId("ea56d808-18f3-44f3-8144-29030e98fac0")).toBe(
      '916534770'
    );
  });

  it('maps mistaken account:dm:peer suffix to peer id', () => {
    seedConversationFixtures();
    expect(normalizeTelegramDeliveryChatId('default:dm:916534770')).toBe('916534770');
  });

  it('maps account:group:peer for supergroups', () => {
    seedConversationFixtures();
    expect(normalizeTelegramDeliveryChatId('default:group:-1001234567890')).toBe(
      '-1001234567890'
    );
  });
});
