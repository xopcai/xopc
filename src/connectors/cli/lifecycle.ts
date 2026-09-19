import { isXopcDatabaseOpen, listConnectorConnections, upsertConnectorConnection } from '../../storage/sqlite/index.js';
import { cancelCliInstanceAuthorizations } from './authorization.js';
import { cancelCliContext } from './process.js';

export function stopCliInstance(instanceId: string, disconnect = false): void {
  cancelCliInstanceAuthorizations(instanceId);
  if (!isXopcDatabaseOpen()) return;
  for (const connection of listConnectorConnections().filter(item => item.provider === 'cli' && item.metadata.runtimeInstanceId === instanceId)) {
    cancelCliContext(String(connection.metadata.contextId));
    if (disconnect) upsertConnectorConnection({ ...connection, status: 'disabled' });
  }
}
