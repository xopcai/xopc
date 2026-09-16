import { recordProcessDiagnostic } from './process-diagnostics.js';
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
    recordProcessDiagnostic('unhandled_rejection', reason);
    const em = reason instanceof Error ? reason.message : String(reason);
    const fields = { err: reason instanceof Error ? reason : undefined, errorMessage: em };
    if (isTransientSqliteError(reason)) {
      log.warn(fields, `Transient SQLite rejection: ${em}`);
    } else {
      log.error(fields, `Unhandled promise rejection: ${em}`);
    }
  });

  state.installed = true;
}
