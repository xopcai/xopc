import { registerMcpProductTools } from '../../../mcp/product-tools.js';
import { getGatewayFileSpaceService } from '../../file-space-service.js';
import type { GatewayService } from '../../service.js';
import { createGatewayProductDispatcher } from '../routes/capability-operations.js';

export function createGatewayMcpDispatcher(service: GatewayService) {
  const dispatcher = createGatewayProductDispatcher({ service });
  registerMcpProductTools(dispatcher, {
    getConfig: () => service.currentConfig,
    getProjects: () => service.projects,
    getFiles: () => getGatewayFileSpaceService(service),
    wake: () => service.dispatchTaskRuns(),
    stop: runId => service.stopDelegatedTaskRun(runId),
    deliverSteer: (conversationId, inputId) => service.deliverDelegatedTaskSteer(conversationId, inputId),
    resumeClarification: wait => service.resumeDelegatedRunClarification(wait),
  });
  return dispatcher;
}
