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
        `(${minimumVersion}). Install and run xopc v0.0.277 before upgrading to this release, ` +
        'or start with a new xopc.db.',
    );
    this.name = 'DatabaseSchemaTooOldError';
    this.dbVersion = dbVersion;
    this.minimumVersion = minimumVersion;
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
