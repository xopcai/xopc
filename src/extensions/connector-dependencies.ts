import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Config } from '../config/schema.js';
import { resolveBundledExtensionsDir, resolveExtensionsDir } from '../config/paths.js';
import { isRecord } from '../utils/is-record.js';

export type ExtensionConnectorDiagnostic = {
  extensionId: string;
  connectorId: string;
  message: string;
};

function isExtensionEnabled(extensionId: string, cfg?: Config): boolean {
  const disabled = cfg?.extensions?.disabled;
  if (Array.isArray(disabled) && disabled.includes(extensionId)) return false;
  const enabled = cfg?.extensions?.enabled;
  return !Array.isArray(enabled) || enabled.length === 0 || enabled.includes(extensionId);
}

function enabledConnectorIds(cfg?: Config): Set<string> {
  const ids = new Set<string>();
  for (const server of Object.values(cfg?.mcp?.servers ?? {})) {
    if (!isRecord(server) || !isRecord(server.xopcConnector)) continue;
    if (server.xopcConnector.managed === true && server.xopcConnector.enabled !== false && typeof server.xopcConnector.connectorId === 'string') {
      ids.add(server.xopcConnector.connectorId);
    }
  }
  for (const instance of Object.values(cfg?.connectors?.instances ?? {})) {
    if (!isRecord(instance) || !isRecord(instance.xopcConnector)) continue;
    if (instance.xopcConnector.managed === true && instance.xopcConnector.enabled !== false && typeof instance.xopcConnector.connectorId === 'string') {
      ids.add(instance.xopcConnector.connectorId);
    }
  }
  return ids;
}

function scanRoot(params: {
  root: string;
  cfg?: Config;
  installed: Set<string>;
  seenExtensions: Set<string>;
  diagnostics: ExtensionConnectorDiagnostic[];
}): void {
  if (!existsSync(params.root)) return;
  for (const entry of readdirSync(params.root, { withFileTypes: true })) {
    if (!entry.isDirectory() || params.seenExtensions.has(entry.name) || !isExtensionEnabled(entry.name, params.cfg)) continue;
    const manifestPath = join(params.root, entry.name, 'xopc.extension.json');
    if (!existsSync(manifestPath)) continue;
    params.seenExtensions.add(entry.name);
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    if (!isRecord(manifest) || !Array.isArray(manifest.connectorDependencies)) continue;
    const dependencies = [...new Set(manifest.connectorDependencies
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean))];
    for (const connectorId of dependencies) {
      if (params.installed.has(connectorId)) continue;
      params.diagnostics.push({
        extensionId: entry.name,
        connectorId,
        message: `Extension "${entry.name}" requires enabled Connector "${connectorId}". Install and connect it from the Connector Store.`,
      });
    }
  }
}

export function inspectExtensionConnectorDependencies(params: {
  cfg?: Config;
  roots?: string[];
}): ExtensionConnectorDiagnostic[] {
  const diagnostics: ExtensionConnectorDiagnostic[] = [];
  const installed = enabledConnectorIds(params.cfg);
  const seenExtensions = new Set<string>();
  const roots = params.roots ?? [resolveExtensionsDir(), resolveBundledExtensionsDir()].filter((root): root is string => Boolean(root));
  for (const root of roots) scanRoot({ root, cfg: params.cfg, installed, seenExtensions, diagnostics });
  return diagnostics;
}
