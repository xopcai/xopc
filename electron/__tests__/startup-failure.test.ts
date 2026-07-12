import { describe, expect, it } from 'vitest';

import {
  classifyGatewayStartupFailure,
  createGatewayTimeoutFailure,
  createPortInUseFailure,
} from '../startup-failure.js';

describe('classifyGatewayStartupFailure', () => {
  it('recognizes a database schema that is newer than the app supports', () => {
    const failure = classifyGatewayStartupFailure({
      port: 18790,
      exitCode: 1,
      rawOutput: `
[DatabaseSchemaTooNewError]: xopc database schema version 24 is newer than this app supports (23).
{
  dbVersion: 24,
  appVersion: 23
}
`,
    });

    expect(failure.kind).toBe('database_schema_too_new');
    expect(failure.dbVersion).toBe(24);
    expect(failure.appVersion).toBe(23);
    expect(failure.port).toBe(18790);
    expect(failure.message).toContain('v24');
  });

  it('recognizes a missing migration gap', () => {
    const failure = classifyGatewayStartupFailure({
      rawOutput:
        'DatabaseSchemaMigrationGapError: xopc database schema version 21 requires migration to v22, but that migration is not bundled.',
    });

    expect(failure.kind).toBe('database_migration_gap');
    expect(failure.missingVersion).toBe(22);
  });

  it('recognizes port conflicts', () => {
    const failure = classifyGatewayStartupFailure({
      port: 18790,
      message: 'Gateway port 18790 is already in use.',
    });

    expect(failure.kind).toBe('port_in_use');
    expect(failure.port).toBe(18790);
  });

  it('creates explicit timeout and port failures', () => {
    expect(createGatewayTimeoutFailure({ port: 18790, timeoutMs: 120_000 }).kind).toBe(
      'gateway_timeout',
    );
    expect(createPortInUseFailure(18790).message).toContain('18790');
  });

  it('falls back to unknown for unclassified startup errors', () => {
    const failure = classifyGatewayStartupFailure({ message: 'boom' });

    expect(failure.kind).toBe('unknown');
    expect(failure.message).toBe('boom');
  });
});
