import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { inspectExtensionConnectorDependencies } from '../connector-dependencies.js';
import { normalizeExtensionManifest } from '../normalize-manifest.js';

describe('Extension Connector dependencies', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function writeExtension(connectorDependencies: unknown): void {
    root = mkdtempSync(join(tmpdir(), 'xopc-extension-connectors-'));
    const extensionDir = join(root, 'notion-workflows');
    mkdirSync(extensionDir);
    writeFileSync(join(extensionDir, 'xopc.extension.json'), JSON.stringify({
      id: 'notion-workflows',
      name: 'Notion Workflows',
      connectorDependencies,
    }));
  }

  it('reports a missing Connector without injecting an MCP server', () => {
    writeExtension(['notion']);
    expect(inspectExtensionConnectorDependencies({ roots: [root], cfg: {} as Config })).toEqual([{
      extensionId: 'notion-workflows',
      connectorId: 'notion',
      message: expect.stringContaining('requires enabled Connector "notion"'),
    }]);
  });

  it('accepts an installed and enabled managed Connector', () => {
    writeExtension(['notion']);
    const config = {
      mcp: {
        servers: {
          notion: {
            url: 'https://mcp.notion.com/mcp',
            xopcConnector: { managed: true, connectorId: 'notion', enabled: true },
          },
        },
      },
    } as Config;
    expect(inspectExtensionConnectorDependencies({ roots: [root], cfg: config })).toEqual([]);
  });

  it('normalizes dependency ids once', () => {
    expect(normalizeExtensionManifest({ id: 'demo', connectorDependencies: [' notion ', 'notion', '', 1] }).connectorDependencies)
      .toEqual(['notion']);
  });
});
