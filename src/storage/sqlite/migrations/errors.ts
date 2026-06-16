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

export class DatabaseSchemaMigrationGapError extends Error {
  readonly dbVersion: number;
  readonly appVersion: number;
  readonly missingVersion: number;

  constructor(dbVersion: number, appVersion: number, missingVersion: number) {
    super(
      `xopc database schema version ${dbVersion} requires migration to v${missingVersion}, ` +
        `but no migration file is bundled with this app (supports up to v${appVersion}). ` +
        'Upgrade xopc to a release that includes the missing migration.',
    );
    this.name = 'DatabaseSchemaMigrationGapError';
    this.dbVersion = dbVersion;
    this.appVersion = appVersion;
    this.missingVersion = missingVersion;
  }
}
