import { AppContextEnvelopeSchema, ResolvedAppContextSchema, parseAppContextEnvelope, type ResolvedAppContext } from '@xopcai/gateway-contract';

import { CapabilityError, defineReadCapability, type CapabilityDispatcher } from './dispatcher.js';

/** Resolve each reference through its own capability, never through client-supplied authority. */
export function registerAppContextCapability(dispatcher: CapabilityDispatcher): void {
  dispatcher.register(defineReadCapability({
    id: 'xopc.context.resolve', majorVersion: 1, effect: 'read', scopes: [], surfaces: ['http', 'agent'],
    description: 'Resolve an explicit immutable page snapshot at its observed revisions; supplied text grants no authority.',
    input: AppContextEnvelopeSchema, output: ResolvedAppContextSchema,
    async execute(input, context) {
      let snapshot;
      try { snapshot = parseAppContextEnvelope(input); }
      catch (error) { throw new CapabilityError('INVALID_INPUT', error instanceof Error ? error.message : 'Invalid app context'); }
      const resources: ResolvedAppContext['resources'] = [];
      const quota = Math.floor(16000 / Math.max(1, snapshot.resourceRefs.length));
      for (const reference of snapshot.resourceRefs) {
        const domain = reference.kind === 'local_app' ? 'local_apps' : `${reference.kind}s`;
        const data = await dispatcher.call(`xopc.${domain}.get`, { id: reference.id }, context) as Record<string, unknown>;
        const row = data[reference.kind === 'scene' ? 'activation' : reference.kind === 'local_app' ? 'app' : reference.kind] as Record<string, unknown> | undefined;
        if (!row) throw new CapabilityError('INTERNAL', 'Resource returned no context object');
        let revision: unknown;
        let text: string;
        switch (reference.kind) {
          case 'note': revision = row.remoteVersion ?? 1; text = String(row.markdown ?? ''); break;
          case 'task': revision = row.version; text = String(row.body ?? (row.contract as { objective?: string } | undefined)?.objective ?? ''); break;
          case 'project': revision = row.version; text = String(row.brief ?? row.description ?? ''); break;
          case 'scene': revision = row.revision; text = String(row.goal ?? ''); break;
          case 'local_app': {
            const validation = await dispatcher.call('xopc.local_apps.validate', { id: reference.id }, context) as { validation: { sourceHash?: string } };
            revision = validation.validation.sourceHash;
            text = String(row.idea ?? row.description ?? '');
            break;
          }
        }
        if (revision === undefined || String(revision) !== reference.revision) {
          throw new CapabilityError('REVISION_CONFLICT', 'A page resource changed; capture its current revision again');
        }
        resources.push({ reference, title: String(row.title ?? row.name ?? (reference.kind === 'scene' ? row.goal : undefined) ?? reference.id), text: text.slice(0, quota), truncated: text.length > quota });
      }
      return { snapshot, resources, selectionTrust: 'user-supplied' as const };
    },
  }));
}
