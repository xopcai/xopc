export type MigrationKind = 'config' | 'state' | 'sqlite' | 'extension';
export type MigrationSafety = 'auto' | 'manual' | 'blocked';
export type MigrationStatus = 'not_needed' | 'planned' | 'applied' | 'skipped' | 'conflict' | 'error';

export interface MigrationPlanItem {
  id: string;
  title: string;
  kind: MigrationKind;
  safety: MigrationSafety;
  status: MigrationStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface MigrationContext {
  configPath: string;
  stateDir?: string;
  now?: Date;
}

export interface Migration {
  id: string;
  kind: MigrationKind;
  safety: MigrationSafety;
  detect(ctx: MigrationContext): MigrationPlanItem | null;
  apply(ctx: MigrationContext): MigrationPlanItem;
}

export interface MigrationLedgerRun {
  id: string;
  status: MigrationStatus;
  appliedAt: string;
  message: string;
}

export interface MigrationLedger {
  version: 1;
  runs: MigrationLedgerRun[];
}
