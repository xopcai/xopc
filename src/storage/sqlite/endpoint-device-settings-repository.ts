import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export interface EndpointDeviceSettings { nickname: string; revision: number }

export function getEndpointDeviceSettings(principalId: string): EndpointDeviceSettings | undefined {
  return getSqliteDatabase().prepare('SELECT nickname, revision FROM endpoint_device_settings WHERE principal_id = ?')
    .get(principalId) as unknown as EndpointDeviceSettings | undefined;
}

/** Compare and swap; revision zero means settings have not been created yet. */
export function renameEndpointDevice(principalId: string, nickname: string, expectedRevision: number): EndpointDeviceSettings | undefined {
  return runSqliteWriteTransaction(db => {
    if (expectedRevision === 0) {
      const result = db.prepare('INSERT OR IGNORE INTO endpoint_device_settings (principal_id, nickname) VALUES (?, ?)')
        .run(principalId, nickname);
      if (!result.changes) return undefined;
    } else {
      const result = db.prepare('UPDATE endpoint_device_settings SET nickname = ?, revision = revision + 1 WHERE principal_id = ? AND revision = ?')
        .run(nickname, principalId, expectedRevision);
      if (!result.changes) return undefined;
    }
    return getEndpointDeviceSettings(principalId);
  });
}
