import { McpServerSchema } from '../config/schema.js';
import { createConnectorSecretReference } from './secret-store.js';
import type { ConnectorDefinition, ConnectorInstallInput, ManagedConnectorMarker } from './types.js';

const SERVER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const TEMPLATE_PATTERN = /^\{\{(secrets|config)\.([A-Za-z0-9_.-]+)\}\}$/;

export function assertValidConnectorServerId(serverId: string): void {
  if (!SERVER_ID_PATTERN.test(serverId)) {
    throw new Error('Connector server name must start with a lowercase letter and only contain lowercase letters, numbers, dashes, and underscores.');
  }
}

function readInputValue(
  definition: ConnectorDefinition,
  input: ConnectorInstallInput,
  scope: 'secrets' | 'config',
  key: string,
): unknown {
  if (scope === 'secrets') {
    return createConnectorSecretReference(definition.id, key);
  }
  return input.config?.[key];
}

function resolveTemplateValue(value: unknown, definition: ConnectorDefinition, input: ConnectorInstallInput): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const match = TEMPLATE_PATTERN.exec(value.trim());
  if (!match) {
    return value;
  }
  return readInputValue(definition, input, match[1] as 'secrets' | 'config', match[2]);
}

function materializeTemplate(value: unknown, definition: ConnectorDefinition, input: ConnectorInstallInput): unknown {
  const resolved = resolveTemplateValue(value, definition, input);
  if (Array.isArray(resolved)) {
    return resolved.map((item) => materializeTemplate(item, definition, input));
  }
  if (resolved && typeof resolved === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(resolved as Record<string, unknown>)) {
      const materializedChild = materializeTemplate(child, definition, input);
      if (materializedChild !== undefined) {
        output[key] = materializedChild;
      }
    }
    return output;
  }
  return resolved;
}

function assertRequiredInputs(definition: ConnectorDefinition, input: ConnectorInstallInput): void {
  for (const secret of definition.setup.secrets ?? []) {
    const value = input.secrets?.[secret.key];
    if (secret.required && (typeof value !== 'string' || value.trim().length === 0)) {
      throw new Error(`Missing required secret: ${secret.key}`);
    }
  }
  for (const field of definition.setup.config ?? []) {
    const value = input.config?.[field.key];
    if (field.required && (value === undefined || value === null || value === '')) {
      throw new Error(`Missing required config: ${field.key}`);
    }
  }
}

export function materializeConnectorMcpServer(
  definition: ConnectorDefinition,
  input: ConnectorInstallInput,
): { serverId: string; server: Record<string, unknown> } {
  assertRequiredInputs(definition, input);
  if (definition.runtime.type !== 'mcp') {
    throw new Error(`Unsupported connector runtime: ${definition.runtime.type}`);
  }

  const rawServerId = materializeTemplate(definition.runtime.serverId, definition, input);
  if (typeof rawServerId !== 'string') {
    throw new Error('Connector server name must be a string.');
  }
  const serverId = rawServerId.trim();
  assertValidConnectorServerId(serverId);

  const rawServer = materializeTemplate(definition.runtime.serverTemplate, definition, input);
  if (!rawServer || typeof rawServer !== 'object' || Array.isArray(rawServer)) {
    throw new Error('Connector MCP server template must resolve to a JSON object.');
  }

  const marker: ManagedConnectorMarker = {
    managed: true,
    connectorId: definition.id,
    version: definition.version,
    displayName: definition.displayName,
    source: definition.source,
    artifactSha256: definition.provenance?.sha256,
    definition,
    ...(input.config && Object.keys(input.config).length > 0 ? { config: input.config } : {}),
  };
  const server = {
    ...(rawServer as Record<string, unknown>),
    xopcConnector: marker,
  };
  const parsed = McpServerSchema.safeParse(server);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid MCP server config.');
  }
  return { serverId, server };
}

export function connectorDefinitionFromManagedMarker(marker: unknown): ConnectorDefinition | undefined {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return undefined;
  const definition = (marker as Record<string, unknown>).definition;
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return undefined;
  const record = definition as Partial<ConnectorDefinition>;
  return typeof record.id === 'string' && typeof record.version === 'string' && record.runtime
    ? record as ConnectorDefinition
    : undefined;
}

export function isManagedConnectorServer(server: unknown): server is Record<string, unknown> & { xopcConnector: ManagedConnectorMarker } {
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    return false;
  }
  const marker = (server as Record<string, unknown>).xopcConnector;
  return Boolean(
    marker &&
      typeof marker === 'object' &&
      !Array.isArray(marker) &&
      (marker as Record<string, unknown>).managed === true &&
      typeof (marker as Record<string, unknown>).connectorId === 'string',
  );
}
