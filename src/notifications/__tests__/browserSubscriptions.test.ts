import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installSceneStorage } from '../../storage/sqlite/scenes-schema.js';
import { BrowserSubscriptionService, enqueueBrowserDispatches } from '../browserSubscriptions.js';

describe('browser subscription ownership and durable queue', () => {
  let db: DatabaseSync;
  const owner = { ownerId: 'owner', workspaceId: 'workspace' };
  const input = { endpoint: 'https://fcm.googleapis.com/send/test', expirationTime: null, language: 'en',
    keys: { auth: Buffer.alloc(16, 1).toString('base64url'), p256dh: Buffer.alloc(65, 2).toString('base64url') } };
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE notification_events(event_id TEXT PRIMARY KEY); INSERT INTO notification_events VALUES (\'event\')');
    installSceneStorage(db); db.exec('PRAGMA foreign_keys = ON');
  });
  afterEach(() => db.close());
  it('keeps keys stable, rejects cross-workspace replacement and enqueues once', () => {
    const service = new BrowserSubscriptionService(db, () => 1000);
    expect(service.prepare()).toEqual(service.prepare());
    const { id } = service.register(owner, input);
    expect(service.register(owner, input).id).toBe(id);
    expect(() => service.register({ ...owner, workspaceId: 'other' }, input)).toThrow('another workspace');
    enqueueBrowserDispatches(db, owner, 'event', 'result', 1, 1000);
    enqueueBrowserDispatches(db, owner, 'event', 'result', 1, 1000);
    expect(db.prepare('SELECT count(*) AS n FROM notification_dispatches').get()?.n).toBe(1);
    service.remove({ ...owner, ownerId: 'other' }, id);
    expect(db.prepare('SELECT count(*) AS n FROM notification_browser_subscriptions').get()?.n).toBe(1);
    service.remove(owner, id);
    expect(db.prepare('SELECT status FROM notification_dispatches').get()?.status).toBe('cancelled');
  });
  it('rejects local destinations, malformed keys and expired subscriptions', () => {
    const service = new BrowserSubscriptionService(db, () => 1000);
    expect(() => service.register(owner, { ...input, endpoint: 'https://127.0.0.1/internal' })).toThrow();
    expect(() => service.register(owner, { ...input, keys: { ...input.keys, auth: 'bad' } })).toThrow();
    expect(() => service.register(owner, { ...input, expirationTime: 999 })).toThrow('expired');
  });
});
