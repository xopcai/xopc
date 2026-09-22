import { ProductReadContracts } from '@xopcai/gateway-contract';

import { CapabilityError, defineReadCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import type { ProjectService } from '../project-service.js';

export function registerProjectReadCapabilities(dispatcher: CapabilityDispatcher, projects: ProjectService): void {
  const requireProject = (id: string) => {
    const project = projects.get(id);
    if (!project) throw new CapabilityError('NOT_FOUND', 'Project not found');
    return project;
  };
  const policy = { majorVersion: 1, effect: 'read' as const, surfaces: ['http', 'agent', 'cli'] as const, scopes: ['workspace.read'] as const };
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.projects.get', description: 'Read a project and its domain details.',
    ...ProductReadContracts['xopc.projects.get'],
    execute({ id }) {
      const project = projects.getWithDetails(id);
      if (!project) throw new CapabilityError('NOT_FOUND', 'Project not found');
      return { ok: true as const, project: { ...project } };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.projects.list', description: 'List projects with filters and pagination.',
    ...ProductReadContracts['xopc.projects.list'],
    execute(input) {
      const result = projects.list(input);
      return { ok: true as const, ...result, items: result.items.map(project => ({ ...project })) };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.projects.list_milestones', description: 'List project milestones.',
    ...ProductReadContracts['xopc.projects.list_milestones'],
    execute({ id }) {
      requireProject(id);
      return { ok: true as const, projectId: id, items: projects.listMilestones(id).map(item => ({ ...item })) };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.projects.list_updates', description: 'List project progress updates.',
    ...ProductReadContracts['xopc.projects.list_updates'],
    execute({ id, limit }) {
      requireProject(id);
      return { ok: true as const, projectId: id, items: projects.listUpdates(id, limit).map(item => ({ ...item })) };
    },
  }));
}
