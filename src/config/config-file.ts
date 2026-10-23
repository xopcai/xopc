import { readFileSync } from 'node:fs';

import { writeTextAtomicSync } from '../infra/write-file-atomic.js';
import { createLogger } from '../utils/logger.js';
import { ConfigSchema, type Config } from './schema.js';

const log = createLogger('ConfigFile');

/** Validate existing settings before committing removal of retired fields. */
export function readConfigFileSnapshot(path: string): {
  config: Config;
  discardRetiredFields: () => void;
} {
  const original = readFileSync(path, 'utf8');
  const raw: unknown = JSON.parse(original);
  const hasRetiredFields = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    && Object.hasOwn(raw, 'workflows');
  const current = hasRetiredFields ? { ...raw } as Record<string, unknown> : raw;
  if (hasRetiredFields) delete (current as Record<string, unknown>).workflows;
  const config = ConfigSchema.parse(current);

  return {
    config,
    discardRetiredFields: () => {
      if (!hasRetiredFields) return;
      try {
        // A validator may be asynchronous; do not overwrite a newer edit.
        if (readFileSync(path, 'utf8') !== original) return;
        writeTextAtomicSync(path, `${JSON.stringify(current, null, 2)}\n`);
      } catch (err) {
        // Read-only settings must not prevent startup with valid current values.
        log.warn({ err, path }, 'Could not remove retired configuration fields from disk');
      }
    },
  };
}
