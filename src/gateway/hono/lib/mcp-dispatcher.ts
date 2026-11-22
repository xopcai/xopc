import { readMcpConnectionGrant } from '../../../mcp/connection-grants.js';
import { registerMcpProductTools } from '../../../mcp/product-tools.js';
import { findRemoteMcpGrantByConnectionId } from '../../../mcp/remote-grants.js';
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
    getGrantPolicy: principalId => {
      if (!principalId.startsWith('mcp:')) return undefined;
      const connectionId = principalId.slice('mcp:'.length);
      const remote = findRemoteMcpGrantByConnectionId(connectionId);
      if (remote) {
        return {
          maxConcurrentRuns: remote.maxConcurrentRuns,
          callback: remote.callback,
        };
      }
      const local = readMcpConnectionGrant(connectionId);
      if (local) {
        return {
          maxConcurrentRuns: local.maxConcurrentRuns,
          callback: local.callback,
        };
      }
      return undefined;
    },
  });
  return dispatcher;
}
