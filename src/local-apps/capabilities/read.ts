import { ProductReadContracts } from '@xopcai/gateway-contract';

import { CapabilityError, defineReadCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import type { LocalAppService } from '../service.js';

export function registerLocalAppReadCapabilities(dispatcher: CapabilityDispatcher, service: LocalAppService): void {
  // Details contain preview bearer URLs; preserve the existing administrative boundary.
  const policy = { majorVersion: 1, effect: 'read' as const, surfaces: ['http', 'agent'] as const, scopes: ['gateway.admin'] as const };
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.local_apps.validate', description: 'Inspect local application files and validation issues without modifying the package or acceptance records.',
    ...ProductReadContracts['xopc.local_apps.validate'],
    execute({ id }) {
      if (!service.get(id)) throw new CapabilityError('NOT_FOUND', 'Local app not found');
      return { validation: service.validate(id) };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.local_apps.list', description: 'List managed local applications.',
    ...ProductReadContracts['xopc.local_apps.list'], execute: () => ({ apps: service.list().map(app => ({ ...app })) }),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.local_apps.get', description: 'Read a local application, its preview and release history.',
    ...ProductReadContracts['xopc.local_apps.get'],
    execute({ id }) {
      const app = service.get(id);
      if (!app) throw new CapabilityError('NOT_FOUND', 'Local app not found');
      return { app: { ...app, releases: app.releases.map(release => ({ ...release })), acceptanceRuns: app.acceptanceRuns.map(run => ({ ...run })) } };
    },
  }));
}
