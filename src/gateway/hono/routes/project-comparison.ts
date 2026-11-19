import {
  PROJECT_COMPARISON_ACTION_PATH,
  ProductReadContracts,
  projectComparisonActionSchema,
} from '@xopcai/gateway-contract';
import type { Hono } from 'hono';

import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { CapabilityDispatcher } from '../../../capabilities/runtime/dispatcher.js';
import { registerProjectReadCapabilities } from '../../../projects/capabilities/read.js';
import { inspectProjectComparison } from '../../../projects/project-comparison.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerProjectComparisonRoutes(authenticated: Hono, { service }: AuthenticatedRouteDeps): void {
  const capabilities = new CapabilityDispatcher();
  registerProjectReadCapabilities(capabilities, service.projects);
  authenticated.post(PROJECT_COMPARISON_ACTION_PATH, async c => {
    const action = projectComparisonActionSchema.safeParse(await c.req.json().catch(() => null));
    if (!action.success) return c.json({ ok: false, code: 'INVALID_INPUT', error: 'Invalid project comparison action' }, 400);
    try {
      const result = await capabilities.call('xopc.projects.get', { id: action.data.action.context.projectId }, capabilityHttpContext(c));
      const { project } = ProductReadContracts['xopc.projects.get'].output.parse(result);
      return c.json(inspectProjectComparison(action.data, project));
    } catch (error) {
      return capabilityHttpError(c, error);
    }
  });
}
