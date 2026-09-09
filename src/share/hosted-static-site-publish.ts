import {
  HostedPublicationPublisher,
  HostedShareBindingStore,
  type HostedShareBinding,
} from './hosted-session-share.js';
import {
  HostedStaticSitePublicationBuilder,
  type HostedStaticSitePublicationSnapshot,
} from './hosted-static-site-publication.js';

export interface PublishHostedStaticSiteInput {
  workspaceRoot: string;
  path: string;
  title?: string;
  description?: string;
  spaFallback?: boolean;
  ttlMs: number;
  maxViews: number | null;
  sessionKey?: string;
  agentId?: string;
}

export interface PublishHostedStaticSiteResult {
  binding: HostedShareBinding;
  snapshot: HostedStaticSitePublicationSnapshot;
}

/** Build, upload, activate, and locally bind one immutable static-site snapshot. */
export async function publishHostedStaticSite(
  input: PublishHostedStaticSiteInput,
  deps: {
    builder?: HostedStaticSitePublicationBuilder;
    publisher?: HostedPublicationPublisher;
    bindings?: HostedShareBindingStore;
  } = {},
): Promise<PublishHostedStaticSiteResult> {
  const builder = deps.builder ?? new HostedStaticSitePublicationBuilder();
  const publisher = deps.publisher ?? new HostedPublicationPublisher();
  const bindings = deps.bindings ?? new HostedShareBindingStore();
  const snapshot = await builder.build(input.workspaceRoot, {
    path: input.path,
    title: input.title,
    description: input.description,
    spaFallback: input.spaFallback,
  });
  const result = await publisher.createPublication(snapshot, {
    ttlMs: input.ttlMs,
    maxViews: input.maxViews,
  });
  const now = new Date().toISOString();
  const binding: HostedShareBinding = {
    ...result,
    kind: 'static_site',
    source: { kind: 'static_site', id: input.path, version: now },
    revisionSources: {
      [String(result.snapshotRevision)]: { kind: 'static_site', id: input.path, version: now },
    },
    workspaceContext: {
      workspaceRoot: input.workspaceRoot,
      ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
    },
    title: snapshot.title,
    description: input.description?.trim() || null,
    attachmentCount: snapshot.fileCount,
    attachmentIds: snapshot.assets.map((asset) => asset.id),
    createdAt: now,
    updatedAt: now,
    revoked: false,
  };
  await bindings.upsert(binding);
  return { binding, snapshot };
}
