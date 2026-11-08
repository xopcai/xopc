import { ProductReadContracts } from '@xopcai/gateway-contract';

import { CapabilityError, defineReadCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import type { ProjectService } from '../project-service.js';
import { LocalAppProjectOutputSchema, LocalAppProjectListSchema, LocalAppMilestonesSchema, LocalAppUpdatesSchema } from '../../local-apps/capabilities/projections.js';

export function registerProjectReadCapabilities(dispatcher: CapabilityDispatcher, projects: ProjectService): void {
  const requireProject = (id: string) => {
    const project = projects.get(id);
    if (!project) throw new CapabilityError('NOT_FOUND', 'Project not found');
    return project;
  };
  const policy = { majorVersion: 1, effect: 'read' as const, surfaces: ['http', 'agent', 'cli'] as const, scopes: ['workspace.read'] as const };
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.projects.get', description: 'Read a project and its domain details.',
    surfaces: ['http', 'agent', 'cli', 'extension'], extensionOutput: LocalAppProjectOutputSchema,
    extensionExecute({ id }) {
      const project = requireProject(id); return { ok: true, project };
    },
    ...ProductReadContracts['xopc.projects.get'],
    execute({ id }) {
      const project = projects.getWithDetails(id);
      if (!project) throw new CapabilityError('NOT_FOUND', 'Project not found');
      return { ok: true as const, project: { ...project } };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.projects.list', description: 'List projects with filters and pagination.',
    surfaces: ['http', 'agent', 'cli', 'extension'], extensionOutput: LocalAppProjectListSchema,
    ...ProductReadContracts['xopc.projects.list'],
    execute(input, context) {
      const result = projects.list({ ...input, ...(context.localApp ? {
        resourceRestriction: { extensionId: context.localApp.extensionId, scope: context.localApp.resourceScopes.projectsRead },
      } : {}) });
      return { ok: true as const, ...result, items: result.items.map(project => ({ ...project })) };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.projects.list_milestones', description: 'List project milestones.',
    surfaces: ['http', 'agent', 'cli', 'extension'], extensionOutput: LocalAppMilestonesSchema,
    ...ProductReadContracts['xopc.projects.list_milestones'],
    execute({ id }) {
      requireProject(id);
      return { ok: true as const, projectId: id, items: projects.listMilestones(id).map(item => ({ ...item })) };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.projects.list_updates', description: 'List project progress updates.',
    surfaces: ['http', 'agent', 'cli', 'extension'], extensionOutput: LocalAppUpdatesSchema,
    ...ProductReadContracts['xopc.projects.list_updates'],
    execute({ id, limit }) {
      requireProject(id);
      return { ok: true as const, projectId: id, items: projects.listUpdates(id, limit).map(item => ({ ...item })) };
    },
  }));
}
