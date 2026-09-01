import { CredentialResolver } from '../auth/credentials.js';
import type { Config } from '../config/schema.js';
import { getConnectorDefinition } from './catalog.js';
import { assertPreferredConnectorStrategy } from './integration-strategy.js';
import { getConnectorInstance, getInstalledConnectorDefinition } from './instances.js';
import { getConnectorRuntimeAdapter } from './runtime-adapter-registry.js';
import type { ConnectorDefinition, ConnectorInstallInput, ConnectorInstance } from './types.js';

export async function installConnectorDefinition(
  config: Config,
  definition: ConnectorDefinition,
  input: ConnectorInstallInput,
  resolver = new CredentialResolver(),
): Promise<ConnectorInstance> {
  assertPreferredConnectorStrategy(definition);
  return await getConnectorRuntimeAdapter(definition.runtime.type).install({ config, definition, input, resolver });
}

export async function installConnector(
  config: Config,
  connectorId: string,
  input: ConnectorInstallInput,
  resolver = new CredentialResolver(),
): Promise<ConnectorInstance> {
  const definition = getConnectorDefinition(connectorId);
  if (!definition) throw new Error(`Unknown connector: ${connectorId}`);
  return await installConnectorDefinition(config, definition, input, resolver);
}

export function updateConnectorConfig(
  config: Config,
  instanceId: string,
  input: ConnectorInstallInput,
): ConnectorInstance {
  const instance = getConnectorInstance(config, instanceId);
  if (!instance) throw new Error(`Connector instance not found: ${instanceId}`);
  const definition = getInstalledConnectorDefinition(config, instanceId);
  if (!definition) throw new Error(`Unknown connector: ${instance.connectorId}`);
  const adapter = getConnectorRuntimeAdapter(definition.runtime.type);
  if (!adapter.update) throw new Error(`Connector type "${definition.runtime.type}" does not support config updates.`);
  return adapter.update({ config, definition, input, resolver: new CredentialResolver(), instanceId });
}

export function uninstallConnector(config: Config, instanceId: string): ConnectorInstance {
  const instance = getConnectorInstance(config, instanceId);
  if (!instance) {
    if (config.mcp?.servers?.[instanceId] || config.connectors?.instances?.[instanceId]) {
      throw new Error(`Connector instance "${instanceId}" is not managed by Connectors.`);
    }
    throw new Error(`Connector instance not found: ${instanceId}`);
  }
  const definition = getInstalledConnectorDefinition(config, instanceId);
  if (!definition) throw new Error(`Unknown connector: ${instance.connectorId}`);
  getConnectorRuntimeAdapter(definition.runtime.type).uninstall({ config, definition, instance });
  return instance;
}
