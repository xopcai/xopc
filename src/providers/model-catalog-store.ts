import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { resolveStateDir } from '../config/paths-state.js';
import { writeTextAtomicSync } from '../infra/write-file-atomic.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ModelCatalogStore');

const CatalogModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  availability: z.enum(['available', 'unavailable']),
  maxOutputTokens: z.number().positive().nullable(),
});

const CatalogSourceSchema = z.object({
  providerId: z.string().min(1),
  baseUrl: z.string().url(),
  api: z.enum(['openai-completions', 'openai-responses']),
  etag: z.string().nullable(),
  recommendedModel: z.string().nullable(),
  lastSuccessAt: z.number().int().nonnegative(),
  models: z.array(CatalogModelSchema),
});

const ModelCatalogSchema = z.object({
  sources: z.record(z.string(), CatalogSourceSchema),
});

export type CatalogModel = z.infer<typeof CatalogModelSchema>;
export type CatalogSource = z.infer<typeof CatalogSourceSchema>;
export type ModelCatalogSnapshot = z.infer<typeof ModelCatalogSchema>;
export type AvailableCatalogModel = Omit<CatalogModel, 'availability'>;

export class ModelCatalogStore {
  constructor(private readonly path = join(resolveStateDir(), 'model-catalog.json')) {}

  load(): ModelCatalogSnapshot {
    if (!existsSync(this.path)) return { sources: {} };
    try {
      const parsed = ModelCatalogSchema.safeParse(JSON.parse(readFileSync(this.path, 'utf8')));
      if (parsed.success) return parsed.data;
      log.warn({ path: this.path, errorMessage: parsed.error.message }, 'Ignoring invalid model catalog snapshot');
    } catch (err) {
      log.warn({ err, path: this.path }, 'Ignoring unreadable model catalog snapshot');
    }
    return { sources: {} };
  }

  getSource(sourceId: string): CatalogSource | undefined {
    return this.load().sources[sourceId];
  }

  saveSource(sourceId: string, source: CatalogSource): void {
    const current = this.load();
    const next = ModelCatalogSchema.parse({
      sources: { ...current.sources, [sourceId]: source },
    });
    writeTextAtomicSync(this.path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  }

  removeSource(sourceId: string): boolean {
    const current = this.load();
    if (!current.sources[sourceId]) return false;
    const { [sourceId]: _removed, ...sources } = current.sources;
    writeTextAtomicSync(this.path, `${JSON.stringify({ sources }, null, 2)}\n`, { mode: 0o600 });
    return true;
  }

  replaceSourceModels(
    sourceId: string,
    source: Omit<CatalogSource, 'models'>,
    models: AvailableCatalogModel[],
  ): { addedCount: number; unavailableCount: number } {
    const previous = this.getSource(sourceId);
    const nextIds = new Set(models.map((model) => model.id));
    const previousAvailableIds = new Set((previous?.models ?? [])
      .filter((model) => model.availability === 'available')
      .map((model) => model.id));
    const unavailable = (previous?.models ?? [])
      .filter((model) => !nextIds.has(model.id))
      .map((model) => ({ ...model, availability: 'unavailable' as const }));
    this.saveSource(sourceId, {
      ...source,
      models: [
        ...models.map((model) => ({ ...model, availability: 'available' as const })),
        ...unavailable,
      ],
    });
    return {
      addedCount: models.filter((model) => !previousAvailableIds.has(model.id)).length,
      unavailableCount: unavailable.length,
    };
  }
}

let globalModelCatalogStore: ModelCatalogStore | undefined;

export function getModelCatalogStore(): ModelCatalogStore {
  globalModelCatalogStore ??= new ModelCatalogStore();
  return globalModelCatalogStore;
}

export function resetModelCatalogStore(): void {
  globalModelCatalogStore = undefined;
}
