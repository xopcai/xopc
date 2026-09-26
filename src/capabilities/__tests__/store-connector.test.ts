import { createHash } from 'node:crypto';

import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  getStoreConnectorInstallPlan,
  parseStoreConnectorCandidateRef,
  searchStoreConnectorInstallCandidates,
} from '../store-connector.js';

const manifest = {
  contractVersion: 1,
  id: 'demo-connector',
  displayName: 'Demo Connector',
  description: 'A verified remote MCP connector.',
  category: 'docs',
  capabilities: ['tools', 'resources', 'runtime.mcp.streamableHttp'],
  auth: { mode: 'none' },
  setup: {},
  permissions: {
    data: ['workspace.read'],
    networkDomains: ['mcp.example.com'],
    localExec: false,
    filesystem: [],
  },
  runtime: {
    type: 'mcp',
    serverId: 'demo_connector',
    serverTemplate: {
      url: 'https://mcp.example.com/mcp',
      transport: 'streamable-http',
    },
  },
};

function archiveForManifest(value = manifest): Buffer {
  const zip = new AdmZip();
  zip.addFile('xopc.connector.json', Buffer.from(JSON.stringify(value)));
  return zip.toBuffer();
}

const localManifest = {
  ...manifest,
  capabilities: ['tools', 'runtime.mcp.stdio'],
  permissions: { localExec: true, filesystem: [], networkDomains: [] },
  runtime: {
    type: 'mcp',
    serverId: 'demo_local_connector',
    localPackage: { registry: 'npm', name: '@acme/mcp-server', version: '1.2.3' },
    serverTemplate: { command: 'npx', args: ['--yes', '@acme/mcp-server@1.2.3'] },
  },
};

function config(): Config {
  return { gateway: { skillsStoreBaseUrl: 'https://store.example.com' } } as Config;
}

function mockStore(archive: Buffer, sha256 = createHash('sha256').update(archive).digest('hex'), value = manifest): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('https://store.example.com/api/v1/packages?')) {
      return new Response(JSON.stringify({
        items: [{
          id: 'pkg_1', name: 'demo-connector', type: 'connector', description: value.description,
          downloads: 10, author: { username: 'xopc', avatarUrl: null }, latestVersion: '1.0.0',
          updatedAt: new Date().toISOString(), connectorManifest: value,
        }],
        meta: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://store.example.com/api/v1/packages/demo-connector') {
      return new Response(JSON.stringify({
        id: 'pkg_1',
        name: 'demo-connector',
        type: 'connector',
        description: value.description,
        latestVersion: {
          version: '1.0.0',
          manifest: value,
          downloadUrl: 'https://store.example.com/files/demo-connector.zip',
          sha256,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://store.example.com/files/demo-connector.zip') {
      return new Response(archive, { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

afterEach(() => vi.restoreAllMocks());

describe('store connector install plans', () => {
  it('accepts a pinned registered CLI adapter and rejects command injection', async () => {
    const cli = { ...manifest, capabilities: ['tools'], auth: { mode: 'cli' }, permissions: { ...manifest.permissions, localExec: true }, runtime: { type: 'cli', adapterId: 'lark', adapterVersion: '1', binaryVersion: '1.0.96' } } as unknown as typeof manifest;
    mockStore(archiveForManifest(cli), undefined, cli);
    expect(await getStoreConnectorInstallPlan(config(), 'demo-connector')).toMatchObject({ definition: { runtime: { type: 'cli', adapterId: 'lark' } } });
    vi.restoreAllMocks();
    const unsafe = { ...cli, runtime: { ...cli.runtime, command: 'sh' } };
    mockStore(archiveForManifest(unsafe), undefined, unsafe);
    await expect(getStoreConnectorInstallPlan(config(), 'demo-connector')).rejects.toThrow('exact registered adapter');
  });
  it('verifies the artifact checksum and returns only a remote MCP definition', async () => {
    const archive = archiveForManifest();
    mockStore(archive);

    const plan = await getStoreConnectorInstallPlan(config(), 'demo-connector');

    expect(plan).toMatchObject({
      packageName: 'demo-connector',
      version: '1.0.0',
      requiresRestart: false,
      permissions: { data: ['workspace.read'], localExec: false },
      definition: {
        source: 'store',
        runtime: { type: 'mcp', serverId: 'demo_connector' },
      },
    });
    expect(plan.reviewHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns exact install candidates with semantic capabilities', async () => {
    const searchable = { ...manifest, provides: [{ id: 'design.mobile.create' }, 'files.read'] };
    mockStore(archiveForManifest(searchable), undefined, searchable);

    const [candidate] = await searchStoreConnectorInstallCandidates(config(), 'mobile design', 5);

    expect(candidate).toMatchObject({
      source: 'store', packageName: 'demo-connector', version: '1.0.0',
      label: 'Demo Connector', capabilities: ['design.mobile.create', 'files.read'],
    });
    expect(parseStoreConnectorCandidateRef(candidate!.candidateRef)).toEqual({ packageName: 'demo-connector', version: '1.0.0' });
  });

  it('rejects a connector whose downloaded artifact does not match the store checksum', async () => {
    const archive = archiveForManifest();
    mockStore(archive, '0'.repeat(64));

    await expect(getStoreConnectorInstallPlan(config(), 'demo-connector')).rejects.toThrow(
      'checksum verification failed',
    );
  });

  it('rejects an artifact that does not explicitly deny local execution', async () => {
    const unsafeManifest = {
      ...manifest,
      permissions: {
        data: ['workspace.read'],
        networkDomains: ['mcp.example.com'],
      },
    };
    const archive = archiveForManifest(unsafeManifest);
    mockStore(archive);

    await expect(getStoreConnectorInstallPlan(config(), 'demo-connector')).rejects.toThrow(
      'explicitly deny local command execution',
    );
  });

  it('materializes local MCP OAuth without requiring a platform broker', async () => {
    const oauthManifest = {
      ...manifest,
      capabilities: [...manifest.capabilities, 'auth.oauth'],
      auth: { mode: 'oauth', clientId: 'public-client-id' },
    };
    const archive = archiveForManifest(oauthManifest);
    mockStore(archive, undefined, oauthManifest);

    await expect(getStoreConnectorInstallPlan(config(), 'demo-connector')).resolves.toMatchObject({
      definition: {
        auth: { mode: 'oauth', clientId: 'public-client-id' },
        runtime: { serverTemplate: { auth: { type: 'oauth', clientId: 'public-client-id' } } },
      },
    });
  });

  it('accepts only the pinned npx form for reviewed local Store connectors', async () => {
    const archive = archiveForManifest(localManifest);
    mockStore(archive, undefined, localManifest);

    const plan = await getStoreConnectorInstallPlan(config(), 'demo-connector');

    expect(plan).toMatchObject({
      permissions: { localExec: true, filesystem: [], networkDomains: [] },
      definition: {
        runtime: {
          localPackage: { registry: 'npm', name: '@acme/mcp-server', version: '1.2.3' },
          serverTemplate: { command: 'npx', args: ['--yes', '@acme/mcp-server@1.2.3'] },
        },
      },
    });
  });

  it('accepts declared secret references in a pinned local environment', async () => {
    const withEnvironment = {
      ...localManifest,
      capabilities: ['tools', 'auth.apiKey', 'runtime.mcp.stdio'],
      auth: { mode: 'apiKey' },
      setup: { secrets: [{ key: 'MAPS_API_KEY', label: 'Maps API key', required: true }] },
      runtime: {
        ...localManifest.runtime,
        serverTemplate: {
          ...localManifest.runtime.serverTemplate,
          env: { MAPS_API_KEY: '{{secrets.MAPS_API_KEY}}' },
        },
      },
    };
    const archive = archiveForManifest(withEnvironment);
    mockStore(archive, undefined, withEnvironment);

    await expect(getStoreConnectorInstallPlan(config(), 'demo-connector')).resolves.toMatchObject({
      definition: { runtime: { serverTemplate: { env: { MAPS_API_KEY: '{{secrets.MAPS_API_KEY}}' } } } },
    });
  });
});
