import type { CredentialResolver } from '../auth/credentials.js';
import type { Config } from '../config/schema.js';
import {
  deleteConnectorInstallation,
  getConnectorInstallation,
  isXopcDatabaseOpen,
  upsertConnectorInstallation,
} from '../storage/sqlite/index.js';
import { saveComposioApiKey } from './composio.js';
import { assertComposioApiKeyConfigured } from './composio-sessions.js';
import { listConnectorInstances } from './instances.js';
import { isManagedConnectorServer, materializeConnectorMcpServer } from './materialize.js';
import { saveConnectorSecrets } from './secret-store.js';
import { appendConnectorAuditRecord } from './usage.js';
import type {
  ConnectorDefinition,
  ConnectorInstallInput,
  ConnectorInstance,
  ConnectorRuntimeDefinition,
} from './types.js';

export type ConnectorRuntimeInstallContext = {
  config: Config;
  definition: ConnectorDefinition;
  input: ConnectorInstallInput;
  resolver: CredentialResolver;
};

export type ConnectorRuntimeUninstallContext = {
  config: Config;
  definition: ConnectorDefinition;
  instance: ConnectorInstance;
};

export type ConnectorRuntimeUpdateContext = ConnectorRuntimeInstallContext & { instanceId: string };

export type ConnectorRuntimeAdapter = {
  type: ConnectorRuntimeDefinition['type'];
  install(context: ConnectorRuntimeInstallContext): Promise<ConnectorInstance>;
  uninstall(context: ConnectorRuntimeUninstallContext): void;
  update?(context: ConnectorRuntimeUpdateContext): ConnectorInstance;
};

const adapters = new Map<ConnectorRuntimeDefinition['type'], ConnectorRuntimeAdapter>();

export function registerConnectorRuntimeAdapter(adapter: ConnectorRuntimeAdapter): void {
  if (adapters.has(adapter.type)) throw new Error(`Connector runtime adapter is already registered: ${adapter.type}`);
  adapters.set(adapter.type, adapter);
}

function installedInstance(config: Config, instanceId: string, connectorId: string): ConnectorInstance {
  const instance = listConnectorInstances(config).find((candidate) => candidate.instanceId === instanceId);
  if (!instance) throw new Error(`Connector "${connectorId}" was installed but could not be resolved.`);
  return instance;
}

function installRecord(config: Config, definition: ConnectorDefinition, extra: Record<string, unknown> = {}): ConnectorInstance {
  const instanceId = definition.id;
  config.connectors = config.connectors ?? {};
  config.connectors.instances = {
    ...(config.connectors.instances ?? {}),
    [instanceId]: {
      xopcConnector: {
        managed: true,
        connectorId: definition.id,
        version: definition.version,
        enabled: true,
        displayName: definition.displayName,
        source: definition.source,
        artifactSha256: definition.provenance?.sha256,
      },
      runtime: definition.runtime,
      ...extra,
    },
  };
  return installedInstance(config, instanceId, definition.id);
}

function uninstallRecord(config: Config, instanceId: string): void {
  const record = config.connectors?.instances?.[instanceId];
  if (!record) throw new Error(`Connector instance not found: ${instanceId}`);
  const nextInstances = { ...(config.connectors?.instances ?? {}) };
  delete nextInstances[instanceId];
  config.connectors = { ...(config.connectors ?? {}), instances: nextInstances };
}

registerConnectorRuntimeAdapter({
  type: 'mcp',
  async install({ config, definition, input, resolver }) {
    if (definition.runtime.type !== 'mcp') throw new Error(`Invalid MCP connector definition: ${definition.id}`);
    const { serverId, server } = materializeConnectorMcpServer(definition, input);
    const existingServer = config.mcp?.servers?.[serverId];
    if (existingServer && !isManagedConnectorServer(existingServer)) {
      throw new Error(`MCP server "${serverId}" already exists and is not managed by Connectors.`);
    }
    await saveConnectorSecrets(definition, input, resolver);
    config.mcp = config.mcp ?? {};
    config.mcp.servers = { ...(config.mcp.servers ?? {}), [serverId]: server };
    const instance = installedInstance(config, serverId, definition.id);
    appendConnectorAuditRecord(config, serverId, { action: 'installed' });
    return instance;
  },
  uninstall({ config, instance }) {
    const server = config.mcp?.servers?.[instance.instanceId];
    if (!server || !isManagedConnectorServer(server)) {
      throw new Error(`MCP server "${instance.instanceId}" is not managed by Connectors.`);
    }
    appendConnectorAuditRecord(config, instance.instanceId, { action: 'removed' });
    const nextServers = { ...(config.mcp?.servers ?? {}) };
    delete nextServers[instance.instanceId];
    config.mcp = { ...(config.mcp ?? {}), servers: nextServers };
  },
  update({ config, definition, input, instanceId }) {
    if (definition.runtime.type !== 'mcp') throw new Error(`Invalid MCP connector definition: ${definition.id}`);
    const existingServer = config.mcp?.servers?.[instanceId];
    if (!existingServer || !isManagedConnectorServer(existingServer)) {
      throw new Error(`MCP server "${instanceId}" is not managed by Connectors.`);
    }
    if ((definition.setup.secrets ?? []).length > 0) {
      throw new Error('Connectors with secrets must be reinstalled to change configuration.');
    }
    const { serverId, server } = materializeConnectorMcpServer(definition, input);
    if (serverId !== instanceId) {
      throw new Error(`Connector config update cannot change server id from "${instanceId}" to "${serverId}".`);
    }
    config.mcp = config.mcp ?? {};
    config.mcp.servers = {
      ...(config.mcp.servers ?? {}),
      [serverId]: {
        ...server,
        xopcConnector: {
          ...existingServer.xopcConnector,
          ...(server.xopcConnector as Record<string, unknown>),
          enabled: existingServer.xopcConnector.enabled,
          lastConnectedAt: existingServer.xopcConnector.lastConnectedAt,
          lastError: existingServer.xopcConnector.lastError,
        },
      },
    };
    return installedInstance(config, serverId, definition.id);
  },
});

registerConnectorRuntimeAdapter({
  type: 'composio',
  async install({ config, definition, input, resolver }) {
    if (definition.runtime.type !== 'composio') throw new Error(`Invalid Composio connector definition: ${definition.id}`);
    if (definition.runtime.role === 'credential') await saveComposioApiKey(input, resolver);
    if (definition.runtime.role === 'toolkit') await assertComposioApiKeyConfigured(resolver);
    const instance = installRecord(
      config,
      definition,
      definition.runtime.role === 'toolkit' ? { scope: 'read' } : {},
    );
    if (definition.runtime.role === 'toolkit' && isXopcDatabaseOpen()) {
      const installationId = `${definition.id}-local-owner`;
      const existing = getConnectorInstallation(installationId);
      upsertConnectorInstallation({
        id: installationId,
        connectorId: definition.id,
        principalId: 'local-owner',
        enabled: true,
        allowedAgentIds: existing?.allowedAgentIds ?? [],
        maxScope: 'read',
        confirmationPolicy: existing?.confirmationPolicy ?? 'writes',
        selectedConnectionIds: existing?.selectedConnectionIds ?? [],
        createdAt: existing?.createdAt,
      });
    }
    return instance;
  },
  uninstall({ config, definition, instance }) {
    if (definition.runtime.type !== 'composio') throw new Error(`Invalid Composio connector definition: ${definition.id}`);
    uninstallRecord(config, instance.instanceId);
    if (definition.runtime.role === 'toolkit' && isXopcDatabaseOpen()) {
      deleteConnectorInstallation(`${definition.id}-local-owner`);
    }
  },
});

for (const type of ['channel', 'nativeTool', 'memorySource'] as const) {
  registerConnectorRuntimeAdapter({
    type,
    async install({ config, definition }) {
      return installRecord(config, definition);
    },
    uninstall({ config, instance }) {
      uninstallRecord(config, instance.instanceId);
    },
  });
}

export function getConnectorRuntimeAdapter(type: ConnectorRuntimeDefinition['type']): ConnectorRuntimeAdapter {
  const adapter = adapters.get(type);
  if (!adapter) throw new Error(`Unknown connector runtime adapter: ${type}`);
  return adapter;
}
