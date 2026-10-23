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
        `(${minimumVersion}). Start with a new xopc.db.`,
    );
    this.name = 'DatabaseSchemaTooOldError';
    this.dbVersion = dbVersion;
    this.minimumVersion = minimumVersion;
  }
}
