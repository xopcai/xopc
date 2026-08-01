import type { ConnectorDefinition } from './types.js';

const BUILTIN_CONNECTOR_BACKGROUNDS: Record<string, string> = {
  filesystem: '#FFF7E6',
};

function builtinBranding(id: string): NonNullable<ConnectorDefinition['branding']> {
  return {
    logoUrl: `/connector-icons/${id}.svg`,
    source: 'builtin',
    backgroundColor: BUILTIN_CONNECTOR_BACKGROUNDS[id] ?? '#FFFFFF',
  };
}

export const BUILTIN_CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: 'local-files',
    version: '1.0.0',
    displayName: 'Local Files / Obsidian',
    description: 'Incrementally ingest text and Markdown from an explicitly selected local folder.',
    category: 'docs',
    kind: 'memorySource',
    source: 'builtin',
    branding: builtinBranding('local-files'),
    capabilities: ['context', 'memory_source'],
    benefits: ['understand'],
    tags: ['files', 'local', 'obsidian', 'knowledge', 'personalization'],
    auth: { mode: 'none' },
    setup: {
      config: [
        {
          key: 'rootPath',
          label: 'Knowledge folder',
          type: 'path',
          required: true,
          placeholder: '/Users/you/Documents/Notes',
          description: 'Only supported text files below this directory are ingested.',
        },
        {
          key: 'autoSync',
          label: 'Automatic sync',
          type: 'boolean',
          defaultValue: true,
          description: 'Keep this knowledge source updated while the gateway is running.',
        },
        {
          key: 'syncIntervalMinutes',
          label: 'Sync interval (minutes)',
          type: 'number',
          defaultValue: 15,
          description: 'Automatic sync interval, clamped between 5 minutes and 24 hours.',
        },
      ],
    },
    runtime: { type: 'memorySource', sourceKind: 'local-folder' },
    integrationStrategy: { lane: 'native', workload: 'core', preferred: true },
  },
  {
    id: 'filesystem',
    version: '1.0.0',
    displayName: 'Filesystem',
    description: 'Read and search files from an explicitly selected local directory.',
    category: 'docs',
    kind: 'mcp',
    source: 'builtin',
    branding: builtinBranding('filesystem'),
    capabilities: ['tools', 'resources', 'runtime.mcp.stdio'],
    benefits: ['understand'],
    tags: ['files', 'local', 'docs'],
    auth: { mode: 'none' },
    setup: {
      config: [
        {
          key: 'rootPath',
          label: 'Allowed directory',
          type: 'path',
          required: true,
          placeholder: '/Users/you/project',
          description: 'The only directory this connector can expose to the MCP runtime.',
        },
      ],
    },
    runtime: {
      type: 'mcp',
      serverId: 'filesystem',
      serverTemplate: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '{{config.rootPath}}'],
      },
    },
    integrationStrategy: { lane: 'mcp', workload: 'high_frequency', preferred: true },
  },
];
