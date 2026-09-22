import { ProductReadContracts } from '@xopcai/gateway-contract';

import { CapabilityError, defineReadCapability, type CapabilityContext, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import type { SceneAccess } from '../httpServices.js';
import { SceneNotFoundError } from '../repository.js';

export function registerSceneReadCapabilities(dispatcher: CapabilityDispatcher, getAccess: (context: CapabilityContext) => SceneAccess | undefined): void {
  const policy = { majorVersion: 1, effect: 'read' as const, surfaces: ['http', 'agent'] as const, scopes: ['gateway.admin'] as const };
  const read = async <T>(context: CapabilityContext, fn: (access: SceneAccess) => T | Promise<T>): Promise<T> => {
    const access = getAccess(context);
    if (!access) throw new CapabilityError('UNAVAILABLE', 'Scene service is unavailable');
    try { return await fn(access); }
    catch (error) {
      if (error instanceof SceneNotFoundError) throw new CapabilityError('NOT_FOUND', 'Scene not found');
      throw error;
    }
  };
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.mail_accounts', description: 'List eligible scene mail accounts under current account policy.', ...ProductReadContracts['xopc.scenes.mail_accounts'],
    execute: (_input, context) => read(context, ({ services, principal }) => ({ accounts: services.mailDiscovery?.listAccounts(principal) ?? [] })),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.mail_sources', description: 'List cached eligible mail source metadata without fetching message bodies.', ...ProductReadContracts['xopc.scenes.mail_sources'],
    execute: ({ limit, afterId }, context) => read(context, ({ services, principal }) => {
      const sources = services.mail.listSources(principal, limit, afterId);
      return { sources, nextCursor: sources.length === limit ? sources.at(-1)!.id : null };
    }),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.results', description: 'List visible scene outcomes scoped to the trusted owner and workspace.', ...ProductReadContracts['xopc.scenes.results'],
    execute: ({ limit, afterId, activationId }, context) => read(context, ({ services, principal }) => {
      const outcomes = services.repository.listInbox(principal, limit, afterId, activationId ?? null);
      return ProductReadContracts['xopc.scenes.results'].output.parse({ outcomes, nextCursor: outcomes.length === limit ? outcomes.at(-1)!.id : null });
    }),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.get_presentation', description: 'Read one visible scene presentation.', ...ProductReadContracts['xopc.scenes.get_presentation'],
    execute: ({ id }, context) => read(context, ({ services, principal }) => ProductReadContracts['xopc.scenes.get_presentation'].output.parse({ outcome: services.repository.getPresentation(principal, id) })),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.get_feedback', description: 'Read feedback for an authorized scene presentation.', ...ProductReadContracts['xopc.scenes.get_feedback'],
    execute: ({ id }, context) => read(context, ({ services, principal }) => ProductReadContracts['xopc.scenes.get_feedback'].output.parse({ feedback: services.inbox.getFeedback(principal, id) })),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.digest_results', description: 'Read a page of authorized digest outcomes.', ...ProductReadContracts['xopc.scenes.digest_results'],
    execute: ({ id, limit, afterId }, context) => read(context, ({ services, principal }) => ProductReadContracts['xopc.scenes.digest_results'].output.parse(services.repository.listDigestResults(principal, id, limit, afterId))),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.metrics', description: 'Read owner-scoped scene usefulness metrics in an explicit time window.', ...ProductReadContracts['xopc.scenes.metrics'],
    execute: ({ days }, context) => read(context, ({ services, principal }) => services.metrics.forUser(principal, days)),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.diagnostics', description: 'Read bounded scene queue and execution diagnostics.', ...ProductReadContracts['xopc.scenes.diagnostics'],
    execute: (_input, context) => read(context, ({ services, principal }) => ProductReadContracts['xopc.scenes.diagnostics'].output.parse(services.metrics.diagnostics(principal))),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.get_preferences', description: 'Read owner-scoped scene preferences without changing execution policy.', ...ProductReadContracts['xopc.scenes.get_preferences'],
    execute: (_input, context) => read(context, ({ services, principal }) => services.preferences.get(principal)),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.preflight', description: 'Check scene setup and requested account/provider permissions without starting execution.', ...ProductReadContracts['xopc.scenes.preflight'],
    execute: (input, context) => read(context, ({ services, principal }) => services.application.preflight(principal, input)),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.templates', description: 'List installed scene templates.', ...ProductReadContracts['xopc.scenes.templates'],
    execute: (_input, context) => read(context, ({ services }) => ({ templates: services.repository.listTemplates() })),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.get_template', description: 'Read an exact installed scene template version.', ...ProductReadContracts['xopc.scenes.get_template'],
    execute: ({ key, version }, context) => read(context, ({ services }) => ({ template: services.repository.getTemplate(key, version) })),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.list', description: 'List scenes within the trusted owner and workspace boundary.', ...ProductReadContracts['xopc.scenes.list'],
    execute: ({ limit, afterId }, context) => read(context, ({ services, principal }) => {
      const activations = services.repository.listActivations(principal, limit, afterId);
      return { activations, nextCursor: activations.length === limit ? activations.at(-1)!.id : null };
    }),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.get', description: 'Read a scene and its runs and schedules under the same resource authorization.', ...ProductReadContracts['xopc.scenes.get'],
    execute: ({ id }, context) => read(context, ({ services, principal }) => ProductReadContracts['xopc.scenes.get'].output.parse({
      activation: services.repository.getActivation(principal, id), runs: services.repository.listRuns(principal, id), schedules: services.repository.listSchedules(principal, id),
    })),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.read_notes', description: 'Read scene notes at their stored revision.', ...ProductReadContracts['xopc.scenes.read_notes'],
    execute: ({ id }, context) => read(context, ({ services, principal }) => ProductReadContracts['xopc.scenes.read_notes'].output.parse({ notes: services.repository.readNotes(principal, id) })),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.list_runs', description: 'Page through runs belonging to an authorized scene.', ...ProductReadContracts['xopc.scenes.list_runs'],
    execute: ({ id, limit, afterId }, context) => read(context, ({ services, principal }) => {
      const runs = services.repository.listRuns(principal, id, limit, afterId);
      return ProductReadContracts['xopc.scenes.list_runs'].output.parse({ runs, nextCursor: runs.length === limit ? runs.at(-1)!.id : null });
    }),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.list_schedules', description: 'Read the schedules of an authorized scene.', ...ProductReadContracts['xopc.scenes.list_schedules'],
    execute: ({ id }, context) => read(context, ({ services, principal }) => ProductReadContracts['xopc.scenes.list_schedules'].output.parse({ schedules: services.repository.listSchedules(principal, id) })),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.scenes.list_work_items', description: 'Page through work items belonging to an authorized scene.', ...ProductReadContracts['xopc.scenes.list_work_items'],
    execute: ({ id, limit, afterId }, context) => read(context, ({ services, principal }) => {
      const workItems = services.repository.listWorkItems(principal, id, limit, afterId);
      return ProductReadContracts['xopc.scenes.list_work_items'].output.parse({ workItems, nextCursor: workItems.length === limit ? workItems.at(-1)!.id : null });
    }),
  }));
}
