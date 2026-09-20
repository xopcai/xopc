import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installSceneStorage } from '../../storage/sqlite/scenes-schema.js';
import { sceneChecksAllowed, ScenePreferenceService } from '../preferences.js';

describe('scene attention controls', () => {
  let db: DatabaseSync;
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    installSceneStorage(db);
    new ScenePreferenceService(db).update(principal, { expectedRevision: 0,
      timezone: 'America/New_York', level: 'quiet', notificationsMuted: true, checksPaused: true,
      checksPausedUntil: '2099-01-01T00:00:00Z', quietStartHour: 20, quietEndHour: 9,
      preferredChannel: 'browser',
      dailyNotificationLimit: 2, digestEnabled: true, digestHour: 17, digestMinute: 30, suppressWhileViewing: false,
    });
  });
  afterEach(() => db.close());

  it('uses CAS and patches only supplied fields, keeping mute separate from check pause', () => {
    const service = new ScenePreferenceService(db);
    const next = service.update(principal, { expectedRevision: 1, notificationsMuted: false });
    expect(next).toMatchObject({ revision: 2, timezone: 'America/New_York', level: 'quiet', checksPaused: true, notificationsMuted: false, preferredChannel: 'browser' });
    expect(() => service.update(principal, { expectedRevision: 1, checksPaused: false })).toThrow('changed');
    expect(sceneChecksAllowed(service.get(principal), Date.now())).toBe(false);
    expect(() => service.update(principal, { expectedRevision: 2, unknown: true })).toThrow();
  });

  it('isolates principals and requires valid destinations and timezones', () => {
    const service = new ScenePreferenceService(db);
    expect(service.get({ ...principal, ownerId: 'other' })).toMatchObject({ revision: 0, checksPaused: false });
    expect(() => service.update(principal, { expectedRevision: 1, timezone: 'invalid' })).toThrow();
    expect(() => service.update(principal, { expectedRevision: 1, preferredChannel: 'telegram' })).toThrow();
    expect(() => service.get({ ...principal, ownerId: '' })).toThrow('required');
  });
});
