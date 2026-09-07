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

const DIRECT_SESSION = 'agent:main:webchat:default:direct:owner';
const GROUP_SESSION = 'agent:main:telegram:group:team';

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
    const config = ConfigSchema.parse({});

    expect(resolveUserContextSessionAccess(config, GROUP_SESSION).enabled).toBe(false);
  });

  it('honors subsystem switches independently', () => {
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
