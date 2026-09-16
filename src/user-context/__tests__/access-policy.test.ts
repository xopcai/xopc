import { requireXopcDatabase as openFixtureDatabase } from '../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("4dffa204-0300-4d2d-89ce-55305490c550", '', {"agentId":"main","sourceChannel":"webchat","sourceChatId":"owner","sessionType":"chat","routing":{"agentId":"main","source":"webchat","accountId":"default","peerKind":"direct","peerId":"owner"}});
  ensureFixtureConversation("bb151cc5-73d2-441c-8f60-ef3984388677", '', {"agentId":"main","sourceChannel":"telegram","sourceChatId":"team","sessionType":"chat","routing":{"agentId":"main","source":"telegram","accountId":"default","peerKind":"group","peerId":"team"}});
}
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  setSessionConfig,
} from '../../storage/sqlite/index.js';
import { resolveUserContextSessionAccess } from '../access-policy.js';

const DIRECT_SESSION = "4dffa204-0300-4d2d-89ce-55305490c550";
const GROUP_SESSION = "bb151cc5-73d2-441c-8f60-ef3984388677";

describe('resolveUserContextSessionAccess', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-user-context-access-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('allows configured memory only in an enabled direct session', () => {
    seedConversationFixtures();
    const config = ConfigSchema.parse({});

    expect(resolveUserContextSessionAccess(config, DIRECT_SESSION)).toEqual({
      enabled: true,
      userModel: true,
      knowledge: true,
      crossSessionHistory: true,
      knowledgeSources: ['session', 'workspace'],
    });
  });

  it.each(['off', 'temporary'] as const)('denies every shared-context path in %s mode', (mode) => {
    seedConversationFixtures();
    const config = ConfigSchema.parse({});
    setSessionConfig(DIRECT_SESSION, { userContextMode: mode }, stateDir);

    expect(resolveUserContextSessionAccess(config, DIRECT_SESSION)).toEqual({
      enabled: false,
      userModel: false,
      knowledge: false,
      crossSessionHistory: false,
      knowledgeSources: [],
    });
  });

  it('denies shared context in group sessions', () => {
    seedConversationFixtures();
    const config = ConfigSchema.parse({});

    expect(resolveUserContextSessionAccess(config, GROUP_SESSION).enabled).toBe(false);
  });

  it('honors subsystem switches independently', () => {
    seedConversationFixtures();
    const config = ConfigSchema.parse({
      userContext: {
        userModel: { enabled: false },
        knowledgeMemory: { enabled: true },
      },
    });

    expect(resolveUserContextSessionAccess(config, DIRECT_SESSION)).toMatchObject({
      enabled: true,
      userModel: false,
      knowledge: true,
    });
  });
});
