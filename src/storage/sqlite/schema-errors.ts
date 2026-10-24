export class DatabaseSchemaTooNewError extends Error {
  readonly dbVersion: number;
  readonly appVersion: number;

  constructor(dbVersion: number, appVersion: number) {
    super(
      `xopc database schema version ${dbVersion} is newer than this app supports (${appVersion}). ` +
        'Upgrade xopc to a newer release or restore xopc.db from backup.',
    );
    this.name = 'DatabaseSchemaTooNewError';
    this.dbVersion = dbVersion;
    this.appVersion = appVersion;
  }
}

export class DatabaseSchemaTooOldError extends Error {
  readonly dbVersion: number;
  readonly minimumVersion: number;

  constructor(dbVersion: number, minimumVersion: number) {
    super(
      `xopc database schema version ${dbVersion} is older than the minimum supported version ` +
        `(${minimumVersion}). Keep xopc.db and its WAL/SHM files; use a release with an upgrade path for this database or contact support.`,
    );
    this.name = 'DatabaseSchemaTooOldError';
    this.dbVersion = dbVersion;
    this.minimumVersion = minimumVersion;
  }
}

export class DatabaseSchemaMigrationGapError extends Error {
  constructor(readonly dbVersion: number, readonly appVersion: number, readonly missingVersion: number) {
    super(`xopc database schema version ${dbVersion} requires migration to v${missingVersion}, but that migration is not bundled.`);
    this.name = 'DatabaseSchemaMigrationGapError';
  }
}

export class DatabaseSchemaMigrationFailedError extends Error {
  constructor(readonly dbVersion: number, readonly appVersion: number, readonly backupPath: string | undefined, cause: unknown) {
    super(`SQLite database upgrade from v${dbVersion} to v${appVersion} failed; the upgrade was rolled back. ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'DatabaseSchemaMigrationFailedError';
  }
}
