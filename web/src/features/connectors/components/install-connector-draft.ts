import type {
  ConnectorDefinition,
  ConnectorHealthResult,
  ConnectorInstance,
  StoreConnectorPermissions,
} from '../connectors-api';

export type InstallDraft = {
  connector: ConnectorDefinition;
  secrets: Record<string, string>;
  config: Record<string, string>;
  installing: boolean;
  error: string | null;
  result: ConnectorInstance | null;
  health: ConnectorHealthResult | null;
  store?: {
    packageName: string;
    version: string;
    permissions: StoreConnectorPermissions;
  };
};

export function buildInitialDraft(
  connector: ConnectorDefinition,
  store?: InstallDraft['store'],
): InstallDraft {
  const secrets: Record<string, string> = {};
  for (const field of connector.setup.secrets ?? []) {
    secrets[field.key] = '';
  }
  const config: Record<string, string> = {};
  for (const field of connector.setup.config ?? []) {
    config[field.key] =
      field.defaultValue === undefined
        ? ''
        : typeof field.defaultValue === 'string'
          ? field.defaultValue
          : JSON.stringify(field.defaultValue, null, 2);
  }
  return {
    connector,
    secrets,
    config,
    installing: false,
    error: null,
    result: null,
    health: null,
    ...(store ? { store } : {}),
  };
}
