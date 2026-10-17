/** One on-disk SQL migration file (target schema version after apply). */
export type SqlMigration = {
  targetVersion: number;
  filename: string;
  sql: string;
};

export type ApplyMigrationsOptions = {
  /** Override migrations directory (tests). Defaults to `<schema-module>/migrations`. */
  migrationsDir?: string;
  /** Target schema version. Defaults to {@link XOPC_DB_SCHEMA_VERSION}. */
  targetVersion?: number;
};
