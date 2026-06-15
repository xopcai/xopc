import { createLogger } from '../utils/logger.js';
import { isTransientSqliteError } from './sqlite-errors.js';
import { resolveGlobalSingleton } from '../utils/global-singleton.js';

const log = createLogger('UnhandledRejection');

const installStateKey = Symbol.for('xopc.unhandledRejection.installed');

type InstallState = {
  installed: boolean;
};

export function installSqliteTransientRejectionHandler(): void {
  const state = resolveGlobalSingleton<InstallState>(installStateKey, () => ({
    installed: false,
  }));
  if (state.installed) {
    return;
  }

  process.on('unhandledRejection', (reason) => {
    if (!isTransientSqliteError(reason)) {
      return;
    }
    const em = reason instanceof Error ? reason.message : String(reason);
    log.warn({ err: reason instanceof Error ? reason : undefined, errorMessage: em }, `Transient SQLite rejection: ${em}`);
  });

  state.installed = true;
}
