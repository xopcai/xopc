import type { Config } from './schema.js';

/** Restore an in-memory config object after a failed persistence attempt. */
export function restoreConfig(config: Config, snapshot: Config): void {
  for (const key of Object.keys(config) as Array<keyof Config>) {
    delete config[key];
  }
  Object.assign(config, snapshot);
}

export class ConfigPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigPersistenceError';
  }
}

export async function persistConfigMutation<T>(params: {
  config: Config;
  mutate: () => T | Promise<T>;
  save: () => Promise<{ saved: boolean; error?: string }>;
}): Promise<T> {
  const snapshot = structuredClone(params.config);
  let result: T;
  try {
    result = await params.mutate();
  } catch (error) {
    restoreConfig(params.config, snapshot);
    throw error;
  }
  try {
    const saved = await params.save();
    if (!saved.saved) throw new ConfigPersistenceError(saved.error ?? 'Failed to save configuration.');
    return result;
  } catch (error) {
    restoreConfig(params.config, snapshot);
    if (error instanceof ConfigPersistenceError) throw error;
    throw new ConfigPersistenceError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}
