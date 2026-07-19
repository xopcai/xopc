import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import AdmZip from 'adm-zip';

import type { Config } from '../config/schema.js';
import { installConnectorDefinition } from '../connectors/install.js';
import type {
  ConnectorDefinition,
  ConnectorInstallInput,
  ConnectorPermissions,
} from '../connectors/types.js';
import {
  downloadConnectorStoreZipBuffer,
  fetchStoreConnectorPackageDetail,
  listConnectorPackages,
  resolveSkillsStoreBaseUrl,
  type SkillsStoreListParams,
} from '../agent/skills/marketplace/adapters/store/store-api-client.js';

type JsonRecord = Record<string, unknown>;

export type StoreConnectorInstallPlan = {
  packageName: string;
  version: string;
  definition: ConnectorDefinition;
  permissions: ConnectorPermissions;
  requiresRestart: false;
};

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return value.map((item) => item.trim());
}

const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_SEMVER = /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function assertSafeRemoteUrl(value: unknown): string {
  const urlString = asString(value, 'Connector MCP endpoint');
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Connector MCP endpoint must be a valid URL.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    isIP(hostname)
  ) {
    throw new Error('Store connectors must use a public HTTPS MCP endpoint.');
  }
  return url.toString();
}

function readPermissions(value: unknown, isLocal: boolean): ConnectorPermissions {
  const permissions = asRecord(value, 'Connector permissions');
  if (permissions.localExec !== isLocal) {
    if (isLocal) throw new Error('Local Store connectors must explicitly allow local command execution.');
    throw new Error('Store connectors must explicitly deny local command execution.');
  }
  const filesystem = permissions.filesystem === undefined
    ? []
    : asStringArray(permissions.filesystem, 'Connector filesystem permissions');
  if (filesystem.length > 0) {
    throw new Error('Store connectors cannot request filesystem access.');
  }
  const networkDomains = asStringArray(permissions.networkDomains, 'Connector network domains');
  if (!isLocal && networkDomains.length === 0) {
    throw new Error('Store connectors must declare at least one network domain.');
  }
  return {
    ...(permissions.data === undefined ? {} : { data: asStringArray(permissions.data, 'Connector data permissions') }),
    networkDomains,
    localExec: isLocal,
    filesystem,
  };
}

function readPinnedLocalRuntime(runtime: JsonRecord, template: JsonRecord): { registry: 'npm'; name: string; version: string } | null {
  if (runtime.localPackage === undefined) return null;
  const localPackage = asRecord(runtime.localPackage, 'Connector localPackage');
  if (localPackage.registry !== 'npm') {
    throw new Error('Local Store connectors must use the npm registry.');
  }
  const name = asString(localPackage.name, 'Connector local package name');
  const version = asString(localPackage.version, 'Connector local package version');
  if (!NPM_PACKAGE_NAME.test(name) || !EXACT_SEMVER.test(version)) {
    throw new Error('Local Store connectors must use a valid exact npm package version.');
  }
  if (template.command !== 'npx' ||
    JSON.stringify(asStringArray(template.args, 'Connector local MCP arguments')) !== JSON.stringify(['--yes', `${name}@${version}`])) {
    throw new Error('Local Store connectors must use the pinned npx launch form.');
  }
  for (const field of ['url', 'env', 'cwd', 'workingDirectory', 'headers', 'transport']) {
    if (field in template) throw new Error('Local Store connectors cannot define additional MCP process fields.');
  }
  return { registry: 'npm', name, version };
}

function readConnectorManifest(
  value: unknown,
  packageName: string,
  version: string,
  sha256: string,
): ConnectorDefinition {
  const manifest = asRecord(value, 'Connector manifest');
  if (asString(manifest.id, 'Connector id') !== packageName) {
    throw new Error('Connector manifest id does not match the store package name.');
  }
  const runtime = asRecord(manifest.runtime, 'Connector runtime');
  if (runtime.type !== 'mcp') {
    throw new Error('Store connectors must use the MCP runtime.');
  }
  const serverTemplate = asRecord(runtime.serverTemplate, 'Connector MCP serverTemplate');
  const localPackage = readPinnedLocalRuntime(runtime, serverTemplate);
  const transport = serverTemplate.transport;
  if (!localPackage && transport !== 'streamable-http' && transport !== 'sse') {
    throw new Error('Store connectors must use streamable-http or sse transport.');
  }
  const auth = asRecord(manifest.auth, 'Connector auth');
  const authMode = auth.mode;
  if (authMode !== 'none' && authMode !== 'apiKey') {
    throw new Error('Store connectors support only none or apiKey authentication.');
  }
  const normalizedAuth: ConnectorDefinition['auth'] = { mode: authMode };
  const category = asString(manifest.category, 'Connector category');
  if (!['code', 'docs', 'browser', 'data', 'automation', 'custom'].includes(category)) {
    throw new Error(`Unsupported connector category: ${category}`);
  }
  const capabilities = asStringArray(manifest.capabilities, 'Connector capabilities');
  const allowedCapabilities = new Set([
    'tools', 'resources', 'prompts', 'context', 'events', 'auth.apiKey',
    'runtime.mcp.stdio', 'runtime.mcp.sse', 'runtime.mcp.streamableHttp',
  ]);
  if (capabilities.some((capability) => !allowedCapabilities.has(capability))) {
    throw new Error('Connector manifest contains an unsupported capability.');
  }
  const setup = manifest.setup === undefined ? {} : asRecord(manifest.setup, 'Connector setup');
  const permissions = readPermissions(manifest.permissions, Boolean(localPackage));
  const endpoint = localPackage ? undefined : assertSafeRemoteUrl(serverTemplate.url);
  const hostname = endpoint ? new URL(endpoint).hostname : undefined;
  if (hostname && permissions.networkDomains?.length && !permissions.networkDomains.includes(hostname)) {
    throw new Error('Connector network permissions must include the MCP endpoint host.');
  }

  return {
    id: packageName,
    version,
    displayName: asString(manifest.displayName, 'Connector displayName'),
    description: asString(manifest.description, 'Connector description'),
    category: category as ConnectorDefinition['category'],
    kind: 'mcp',
    source: 'store',
    capabilities: capabilities as ConnectorDefinition['capabilities'],
    ...(Array.isArray(manifest.tags) ? { tags: asStringArray(manifest.tags, 'Connector tags') } : {}),
    auth: normalizedAuth,
    setup: setup as ConnectorDefinition['setup'],
    runtime: {
      type: 'mcp',
      serverId: asString(runtime.serverId, 'Connector MCP serverId'),
      serverTemplate: localPackage ? serverTemplate : { ...serverTemplate, url: endpoint },
      ...(localPackage ? { localPackage } : {}),
    },
    permissions,
    provenance: { packageName, sha256 },
  };
}

function readConnectorManifestFromArchive(buffer: Buffer): unknown {
  let archive: AdmZip;
  try {
    archive = new AdmZip(buffer);
  } catch {
    throw new Error('Store connector artifact is not a valid zip archive.');
  }
  const entry = archive.getEntries().find((candidate) => {
    const path = candidate.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
    return !candidate.isDirectory && (path === 'xopc.connector.json' || path.endsWith('/xopc.connector.json'));
  });
  if (!entry) {
    throw new Error('Store connector artifact is missing xopc.connector.json.');
  }
  try {
    return JSON.parse(entry.getData().toString('utf8'));
  } catch {
    throw new Error('Store connector manifest is not valid JSON.');
  }
}

export async function listStoreConnectors(config: Config, params: SkillsStoreListParams) {
  return listConnectorPackages(resolveSkillsStoreBaseUrl(config), params);
}

export async function getStoreConnectorInstallPlan(
  config: Config,
  packageName: string,
  version?: string,
): Promise<StoreConnectorInstallPlan> {
  const storeBaseUrl = resolveSkillsStoreBaseUrl(config);
  const detail = await fetchStoreConnectorPackageDetail(storeBaseUrl, packageName, version);
  const sha256 = detail.latestVersion.sha256;
  if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error('Store connector version is missing a valid SHA-256 checksum.');
  }
  const archive = await downloadConnectorStoreZipBuffer(storeBaseUrl, detail.latestVersion.downloadUrl);
  const actualSha256 = createHash('sha256').update(archive).digest('hex');
  if (actualSha256 !== sha256.toLowerCase()) {
    throw new Error('Store connector artifact checksum verification failed.');
  }
  const artifactManifest = readConnectorManifestFromArchive(archive);
  const definition = readConnectorManifest(
    artifactManifest,
    detail.name,
    detail.latestVersion.version,
    actualSha256,
  );
  const storeManifest = readConnectorManifest(
    detail.latestVersion.manifest,
    detail.name,
    detail.latestVersion.version,
    actualSha256,
  );
  if (JSON.stringify(definition.runtime) !== JSON.stringify(storeManifest.runtime)) {
    throw new Error('Store connector metadata does not match its verified artifact.');
  }
  return {
    packageName: detail.name,
    version: detail.latestVersion.version,
    permissions: definition.permissions ?? {},
    requiresRestart: false,
    definition,
  };
}

export async function installStoreConnector(
  config: Config,
  packageName: string,
  input: ConnectorInstallInput,
  version?: string,
) {
  const plan = await getStoreConnectorInstallPlan(config, packageName, version);
  const instance = await installConnectorDefinition(config, plan.definition, input);
  return { instance, plan };
}
