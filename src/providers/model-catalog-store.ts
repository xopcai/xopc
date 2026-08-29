import { ModelCatalogPersistence } from './model-catalog-persistence.js';
import type {
  AvailableCatalogModel,
  CatalogSource,
  CatalogSourceOrigin,
  ModelCatalogSnapshot,
} from './model-catalog-types.js';

export type {
  AvailableCatalogModel,
  CatalogModel,
  CatalogSource,
  CatalogSourceOrigin,
  ModelCatalogSnapshot,
} from './model-catalog-types.js';

export class ModelCatalogStore {
  private sources: Record<string, CatalogSource> = {};
  private origins: Record<string, CatalogSourceOrigin> = {};

  load(): ModelCatalogSnapshot {
    return {
      sources: Object.fromEntries(
        Object.entries(this.sources).map(([id, source]) => [id, this.cloneSource(source)]),
      ),
    };
  }

  getSource(sourceId: string): CatalogSource | undefined {
    const source = this.sources[sourceId];
    return source ? this.cloneSource(source) : undefined;
  }

  getSourceOrigin(sourceId: string): CatalogSourceOrigin | undefined {
    return this.origins[sourceId];
  }

  saveSource(
    sourceId: string,
    source: CatalogSource,
    origin: CatalogSourceOrigin = 'memory',
  ): void {
    this.sources = { ...this.sources, [sourceId]: this.cloneSource(source) };
    this.origins = { ...this.origins, [sourceId]: origin };
  }

  removeSource(sourceId: string): boolean {
    if (!this.sources[sourceId]) return false;
    const { [sourceId]: _removed, ...sources } = this.sources;
    const { [sourceId]: _removedOrigin, ...origins } = this.origins;
    this.sources = sources;
    this.origins = origins;
    return true;
  }

  replaceSourceModels(
    sourceId: string,
    source: Omit<CatalogSource, 'models'>,
    models: AvailableCatalogModel[],
    origin: CatalogSourceOrigin = 'memory',
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
    }, origin);
    return {
      addedCount: models.filter((model) => !previousAvailableIds.has(model.id)).length,
      unavailableCount: unavailable.length,
    };
  }

  private cloneSource(source: CatalogSource): CatalogSource {
    return {
      ...source,
      models: source.models.map((model) => ({
        ...model,
        input: [...model.input],
        output: [...model.output],
        operations: [...model.operations],
        ...(model.imageGeneration ? {
          imageGeneration: {
            ...model.imageGeneration,
            sizes: [...model.imageGeneration.sizes],
            aspectRatios: [...(model.imageGeneration.aspectRatios ?? [])],
            qualities: [...model.imageGeneration.qualities],
            formats: [...model.imageGeneration.formats],
            backgrounds: [...model.imageGeneration.backgrounds],
          },
        } : {}),
        ...(model.stt ? { stt: { ...model.stt, inputFormats: [...model.stt.inputFormats], languages: [...model.stt.languages], timestamps: [...model.stt.timestamps] } } : {}),
        ...(model.tts ? { tts: { ...model.tts, languages: [...model.tts.languages], outputFormats: [...model.tts.outputFormats] } } : {}),
      })),
    };
  }
}

let globalModelCatalogStore: ModelCatalogStore | undefined;
let globalCatalogHydrated = false;

export function getModelCatalogStore(): ModelCatalogStore {
  globalModelCatalogStore ??= new ModelCatalogStore();
  if (!globalCatalogHydrated) {
    globalCatalogHydrated = true;
    // Synchronous hydration keeps every process entry point safe before its first registry read.
    const source = new ModelCatalogPersistence().loadSync();
    if (source) globalModelCatalogStore.saveSource('xopc-cloud', source, 'disk');
  }
  return globalModelCatalogStore;
}

export function resetModelCatalogStore(options: { rehydrate?: boolean } = {}): void {
  globalModelCatalogStore = undefined;
  if (options.rehydrate) globalCatalogHydrated = false;
}
