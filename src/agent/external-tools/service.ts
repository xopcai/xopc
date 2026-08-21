import crypto from 'node:crypto';

import Ajv2020 from 'ajv/dist/2020.js';

import type {
  ExternalToolExecutionContext,
  ExternalToolProvider,
  ExternalToolSearchHit,
  ExternalToolSource,
  VersionedExternalToolDescriptor,
} from './types.js';

const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;
const MAX_DESCRIBE_COUNT = 3;
const MAX_DESCRIPTOR_BYTES = 64 * 1024;

function normalizedTokens(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
}

function relevanceScore(hit: ExternalToolSearchHit, query: string): number {
  const haystack = `${hit.title} ${hit.summary} ${hit.namespace}`.toLowerCase();
  const tokens = normalizedTokens(query);
  if (tokens.length === 0) return 0;
  return tokens.reduce((score, token) => {
    if (hit.title.toLowerCase() === token) return score + 8;
    if (hit.title.toLowerCase().includes(token)) return score + 4;
    return haystack.includes(token) ? score + 1 : score;
  }, 0);
}

function descriptorRevision(descriptor: Omit<VersionedExternalToolDescriptor, 'revision'>): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      toolRef: descriptor.toolRef,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
    }))
    .digest('hex')
    .slice(0, 16);
}

function versionDescriptor(
  descriptor: Omit<VersionedExternalToolDescriptor, 'revision'>,
): VersionedExternalToolDescriptor {
  return { ...descriptor, revision: descriptorRevision(descriptor) };
}

export class ExternalToolService {
  private readonly providerBySource: Map<ExternalToolSource, ExternalToolProvider>;
  private readonly ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
    validateSchema: false,
  });

  constructor(providers: ExternalToolProvider[]) {
    this.providerBySource = new Map(providers.map((provider) => [provider.source, provider]));
  }

  async search(params: {
    query: string;
    sources?: ExternalToolSource[];
    limit?: number;
  }): Promise<{ tools: ExternalToolSearchHit[]; unavailableSources: ExternalToolSource[] }> {
    const selected: ExternalToolProvider[] = params.sources?.length
      ? params.sources
          .map((source) => this.providerBySource.get(source))
          .filter((provider): provider is ExternalToolProvider => provider !== undefined)
      : [...this.providerBySource.values()];
    const settled = await Promise.allSettled(
      selected.map(async (provider) => ({ provider, hits: await provider!.search(params.query) })),
    );
    const unavailableSources: ExternalToolSource[] = [];
    const hits: ExternalToolSearchHit[] = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === 'fulfilled') {
        hits.push(...result.value.hits);
      } else {
        const provider = selected[index];
        if (provider) unavailableSources.push(provider.source);
      }
    }
    const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, params.limit ?? DEFAULT_SEARCH_LIMIT));
    const tools = hits
      .map((hit) => ({ hit, score: relevanceScore(hit, params.query) }))
      .filter((entry) => entry.score > 0 || normalizedTokens(params.query).length === 0)
      .toSorted((left, right) => right.score - left.score || left.hit.toolRef.localeCompare(right.hit.toolRef))
      .slice(0, limit)
      .map(({ hit }) => ({
        toolRef: hit.toolRef,
        source: hit.source,
        namespace: hit.namespace,
        title: hit.title,
        summary: hit.summary.slice(0, 300),
      }));
    return { tools, unavailableSources };
  }

  async describe(toolRefs: string[]): Promise<{
    tools: VersionedExternalToolDescriptor[];
    notFound: string[];
  }> {
    if (toolRefs.length === 0 || toolRefs.length > MAX_DESCRIBE_COUNT) {
      throw new Error(`Describe between 1 and ${MAX_DESCRIBE_COUNT} tools per call.`);
    }
    const tools: VersionedExternalToolDescriptor[] = [];
    const notFound: string[] = [];
    for (const toolRef of toolRefs) {
      const provider = this.providerForRef(toolRef);
      const descriptor = provider ? await provider.describe(toolRef) : undefined;
      if (!descriptor) {
        notFound.push(toolRef);
        continue;
      }
      const versioned = versionDescriptor(descriptor);
      if (Buffer.byteLength(JSON.stringify(versioned), 'utf8') > MAX_DESCRIPTOR_BYTES) {
        throw new Error(`Tool contract is too large to expose safely: ${toolRef}`);
      }
      tools.push(versioned);
    }
    return { tools, notFound };
  }

  async execute(params: {
    toolRef: string;
    revision: string;
    arguments?: Record<string, unknown>;
    approvalId?: string;
    context: ExternalToolExecutionContext;
  }) {
    const provider = this.providerForRef(params.toolRef);
    if (!provider) throw new Error(`Unknown external tool source: ${params.toolRef}`);
    const descriptor = await provider.describe(params.toolRef);
    if (!descriptor) throw new Error(`External tool is unavailable: ${params.toolRef}`);
    const current = versionDescriptor(descriptor);
    if (current.revision !== params.revision) {
      throw new Error(`Tool contract changed. Describe ${params.toolRef} again before executing it.`);
    }
    const args = params.arguments ?? {};
    let validate: ReturnType<typeof this.ajv.compile>;
    try {
      validate = this.ajv.compile(current.inputSchema);
    } catch (error) {
      throw new Error(`Tool contract is invalid: ${params.toolRef}`, { cause: error });
    }
    if (!validate(args)) {
      throw new Error(`Arguments do not match ${params.toolRef}: ${this.ajv.errorsText(validate.errors)}`);
    }
    return provider.execute(params.toolRef, args, params.approvalId, params.context);
  }

  private providerForRef(toolRef: string): ExternalToolProvider | undefined {
    const separator = toolRef.indexOf(':');
    if (separator <= 0) return undefined;
    return this.providerBySource.get(toolRef.slice(0, separator) as ExternalToolSource);
  }
}
