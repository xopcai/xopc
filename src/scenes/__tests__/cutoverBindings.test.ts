import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveSceneCutoverBindings } from '../cutoverBindings.js';

describe('explicit cutover ownership', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE proactive_scenario_subscriptions(workspace_id TEXT);
      CREATE TABLE proactive_web_push_subscriptions(workspace_id TEXT);
      INSERT INTO proactive_scenario_subscriptions VALUES ('work');
      INSERT INTO proactive_web_push_subscriptions VALUES ('home')`);
  });
  afterEach(() => db.close());

  it('does not infer ownership from the current login or the workspace name', () => {
    expect(() => resolveSceneCutoverBindings(db, [])).toThrow('explicit workspace ownership');
    expect(() => resolveSceneCutoverBindings(db, [{ workspaceId: 'work', ownerId: 'gateway-owner' }])).toThrow('explicit workspace ownership');
  });

  it('preserves independently specified owners including notification-only workspaces', () => {
    const bindings = [{ workspaceId: 'work', ownerId: 'alice' }, { workspaceId: 'home', ownerId: 'bob' }];
    expect(resolveSceneCutoverBindings(db, bindings)).toEqual(bindings);
  });

  it('rejects duplicate, ambiguous, invalid and unexpected bindings', () => {
    expect(() => resolveSceneCutoverBindings(db, [{ workspaceId: 'work', ownerId: 'alice' }, { workspaceId: 'work', ownerId: 'bob' }])).toThrow('Duplicate');
    expect(() => resolveSceneCutoverBindings(db, [{ workspaceId: 'work', ownerId: '' }])).toThrow();
    expect(() => resolveSceneCutoverBindings(db, [{ workspaceId: 'work', ownerId: 'alice', grantAllAccounts: true }])).toThrow();
    db.exec('INSERT INTO proactive_scenario_subscriptions VALUES (NULL)');
    expect(() => resolveSceneCutoverBindings(db, [{ workspaceId: 'work', ownerId: 'alice' }, { workspaceId: 'home', ownerId: 'bob' }])).toThrow('invalid workspace');
  });
});
