export interface CatalogModel {
  id: string;
  name: string;
  availability: 'available' | 'unavailable';
  kind: 'language' | 'image';
  input: Array<'text' | 'image'>;
  output: Array<'text' | 'image'>;
  operations: Array<'chat.completions' | 'responses' | 'images.generate' | 'images.edit'>;
  reasoning: boolean;
  contextWindow: number;
  maxOutputTokens: number | null;
  imageGeneration?: {
    maxCount: number;
    sizes: string[];
    aspectRatios?: string[];
    qualities: Array<'low' | 'medium' | 'high' | 'auto'>;
    formats: Array<'png' | 'jpeg' | 'webp'>;
    backgrounds: Array<'transparent' | 'opaque' | 'auto'>;
    maxInputImages: number;
  };
}

export interface CatalogSource {
  providerId: string;
  baseUrl: string;
  api: 'openai-completions' | 'openai-responses';
  etag: string | null;
  recommendedModel: string | null;
  lastSuccessAt: number;
  models: CatalogModel[];
}

export interface ModelCatalogSnapshot {
  sources: Record<string, CatalogSource>;
}

export type AvailableCatalogModel = Omit<CatalogModel, 'availability'>;

export class ModelCatalogStore {
  private sources: Record<string, CatalogSource> = {};

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

  saveSource(sourceId: string, source: CatalogSource): void {
    this.sources = { ...this.sources, [sourceId]: this.cloneSource(source) };
  }

  removeSource(sourceId: string): boolean {
    if (!this.sources[sourceId]) return false;
    const { [sourceId]: _removed, ...sources } = this.sources;
    this.sources = sources;
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
      })),
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
