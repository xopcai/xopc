export type GatewayStartupFailureKind =
  | 'database_schema_too_new'
  | 'database_migration_gap'
  | 'port_in_use'
  | 'gateway_timeout'
  | 'unknown';

export type GatewayStartupFailure = {
  kind: GatewayStartupFailureKind;
  message: string;
  rawOutput?: string;
  port?: number;
  exitCode?: number | null;
  signal?: string | null;
  dbVersion?: number;
  appVersion?: number;
  missingVersion?: number;
  configPath?: string;
  stateDir?: string;
  dbPath?: string;
  appRelease?: string;
  isPackaged?: boolean;
};

export class GatewayStartupError extends Error {
  readonly failure: GatewayStartupFailure;

  constructor(failure: GatewayStartupFailure) {
    super(failure.message);
    this.name = 'GatewayStartupError';
    this.failure = failure;
  }
}

export function isGatewayStartupError(error: unknown): error is GatewayStartupError {
  return error instanceof GatewayStartupError;
}

export function createPortInUseFailure(port: number, message?: string): GatewayStartupFailure {
  return {
    kind: 'port_in_use',
    port,
    message:
      message ??
      `Gateway port ${port} is already in use, but the process on that port does not accept the configured xopc gateway token.`,
  };
}

export function createGatewayTimeoutFailure(params: {
  port: number;
  timeoutMs: number;
  rawOutput?: string;
}): GatewayStartupFailure {
  return {
    kind: 'gateway_timeout',
    port: params.port,
    rawOutput: params.rawOutput,
    message: `Gateway did not become ready within ${params.timeoutMs}ms.`,
  };
}

export function classifyGatewayStartupFailure(params: {
  rawOutput?: string;
  message?: string;
  port?: number;
  exitCode?: number | null;
  signal?: string | null;
}): GatewayStartupFailure {
  const text = [params.message, params.rawOutput].filter(Boolean).join('\n');

  const tooNew =
    /DatabaseSchemaTooNewError/.test(text) ||
    /database schema version\s+\d+\s+is newer than this app supports\s+\(\d+\)/i.test(text);
  if (tooNew) {
    const dbVersion =
      numberFromMatch(text, /dbVersion:\s*(\d+)/) ??
      numberFromMatch(text, /database schema version\s+(\d+)\s+is newer/i);
    const appVersion =
      numberFromMatch(text, /appVersion:\s*(\d+)/) ??
      numberFromMatch(text, /newer than this app supports\s+\((\d+)\)/i);
    return {
      kind: 'database_schema_too_new',
      dbVersion,
      appVersion,
      rawOutput: params.rawOutput,
      port: params.port,
      exitCode: params.exitCode,
      signal: params.signal,
      message:
        dbVersion !== undefined && appVersion !== undefined
          ? `Database schema v${dbVersion} is newer than this app supports (v${appVersion}).`
          : 'The local database was created by a newer xopc version.',
    };
  }

  const migrationGap =
    /DatabaseSchemaMigrationGapError/.test(text) ||
    /requires migration to v\d+.*but that migration is not bundled/i.test(text) ||
    /missing migration file/i.test(text);
  if (migrationGap) {
    const dbVersion = numberFromMatch(text, /dbVersion:\s*(\d+)/);
    const appVersion = numberFromMatch(text, /appVersion:\s*(\d+)/);
    const missingVersion =
      numberFromMatch(text, /missingVersion:\s*(\d+)/) ??
      numberFromMatch(text, /migration to v(\d+)/i);
    return {
      kind: 'database_migration_gap',
      dbVersion,
      appVersion,
      missingVersion,
      rawOutput: params.rawOutput,
      port: params.port,
      exitCode: params.exitCode,
      signal: params.signal,
      message:
        missingVersion !== undefined
          ? `This app is missing the SQLite migration to v${missingVersion}.`
          : 'This app is missing a required SQLite migration.',
    };
  }

  if (/EADDRINUSE|port \d+ is already in use|address already in use/i.test(text)) {
    return createPortInUseFailure(
      params.port ?? numberFromMatch(text, /port\s+(\d+)\s+is already in use/i) ?? 0,
      params.message,
    );
  }

  return {
    kind: 'unknown',
    rawOutput: params.rawOutput,
    port: params.port,
    exitCode: params.exitCode,
    signal: params.signal,
    message: params.message || 'The local gateway failed to start.',
  };
}

export function enrichGatewayStartupFailure(
  failure: GatewayStartupFailure,
  patch: Partial<GatewayStartupFailure>,
): GatewayStartupFailure {
  return { ...failure, ...withoutUndefined(patch) };
}

function numberFromMatch(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  if (!match?.[1]) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>;
}
