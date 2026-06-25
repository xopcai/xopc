import type { ConnectorDefinition } from './types.js';

function remoteMcpConnector(params: {
  id: string;
  displayName: string;
  description: string;
  category: ConnectorDefinition['category'];
  tags: string[];
}): ConnectorDefinition {
  return {
    id: params.id,
    version: '1.0.0',
    displayName: params.displayName,
    description: params.description,
    category: params.category,
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'resources', 'prompts', 'auth.apiKey', 'runtime.mcp.streamableHttp'],
    tags: params.tags,
    auth: { mode: 'apiKey' },
    setup: {
      secrets: [
        {
          key: 'AUTHORIZATION_HEADER',
          label: 'Authorization header value',
          description: 'Full Authorization header value for the remote MCP endpoint, for example "Bearer ...".',
          required: true,
        },
      ],
      config: [
        {
          key: 'url',
          label: 'MCP endpoint URL',
          type: 'string',
          required: true,
          placeholder: 'https://example.com/mcp',
          description: 'Streamable HTTP MCP endpoint exposed by your provider or gateway.',
        },
      ],
    },
    runtime: {
      type: 'mcp',
      serverId: params.id,
      serverTemplate: {
        url: '{{config.url}}',
        transport: 'streamable-http',
        headers: {
          Authorization: '{{secrets.AUTHORIZATION_HEADER}}',
        },
      },
    },
  };
}

export const BUILTIN_CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: 'fetch',
    version: '1.0.0',
    displayName: 'Fetch',
    description: 'Fetch and read web pages through the official MCP fetch server.',
    category: 'docs',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.stdio'],
    tags: ['web', 'docs', 'http'],
    auth: { mode: 'none' },
    setup: {},
    runtime: {
      type: 'mcp',
      serverId: 'fetch',
      serverTemplate: {
        command: 'uvx',
        args: ['mcp-server-fetch'],
      },
    },
  },
  {
    id: 'filesystem',
    version: '1.0.0',
    displayName: 'Filesystem',
    description: 'Read and search files from an explicitly selected local directory.',
    category: 'docs',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'resources', 'runtime.mcp.stdio'],
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
  },
  {
    id: 'time',
    version: '1.0.0',
    displayName: 'Time',
    description: 'Convert time zones and answer current-time questions through an MCP time server.',
    category: 'automation',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.stdio'],
    tags: ['time', 'timezone', 'utility'],
    auth: { mode: 'none' },
    setup: {},
    runtime: {
      type: 'mcp',
      serverId: 'time',
      serverTemplate: {
        command: 'uvx',
        args: ['mcp-server-time'],
      },
    },
  },
  {
    id: 'playwright',
    version: '1.0.0',
    displayName: 'Playwright',
    description: 'Automate and inspect browser pages through the official Playwright MCP server.',
    category: 'browser',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.stdio'],
    tags: ['browser', 'automation', 'testing'],
    auth: { mode: 'none' },
    setup: {},
    runtime: {
      type: 'mcp',
      serverId: 'playwright',
      serverTemplate: {
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest'],
      },
    },
  },
  {
    id: 'github',
    version: '1.0.0',
    displayName: 'GitHub',
    description: 'Work with GitHub repositories, issues, pull requests, and code search.',
    category: 'code',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'auth.oauth', 'runtime.mcp.stdio'],
    tags: ['code', 'repository', 'issues'],
    auth: { mode: 'oauth' },
    setup: {},
    runtime: {
      type: 'mcp',
      serverId: 'github',
      serverTemplate: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: '{{secrets.GITHUB_PERSONAL_ACCESS_TOKEN}}',
        },
      },
    },
  },
  {
    id: 'memory',
    version: '1.0.0',
    displayName: 'Memory',
    description: 'Give the agent a simple MCP knowledge graph memory store.',
    category: 'data',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'resources', 'runtime.mcp.stdio', 'memory_source'],
    tags: ['memory', 'knowledge', 'personalization'],
    auth: { mode: 'none' },
    setup: {},
    runtime: {
      type: 'mcp',
      serverId: 'memory',
      serverTemplate: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
      },
    },
  },
  {
    id: 'sequential-thinking',
    version: '1.0.0',
    displayName: 'Sequential Thinking',
    description: 'Add a structured reasoning scratchpad MCP server for multi-step tasks.',
    category: 'automation',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.stdio'],
    tags: ['reasoning', 'planning', 'utility'],
    auth: { mode: 'none' },
    setup: {},
    runtime: {
      type: 'mcp',
      serverId: 'sequential-thinking',
      serverTemplate: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      },
    },
  },
  {
    id: 'brave-search',
    version: '1.0.0',
    displayName: 'Brave Search',
    description: 'Search the web through the Brave Search MCP server.',
    category: 'docs',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'auth.apiKey', 'runtime.mcp.stdio'],
    tags: ['search', 'web', 'research'],
    auth: { mode: 'apiKey' },
    setup: {
      secrets: [
        {
          key: 'BRAVE_API_KEY',
          label: 'Brave API key',
          description: 'Stored in the xopc credential store and passed to the MCP server at runtime.',
          required: true,
        },
      ],
    },
    runtime: {
      type: 'mcp',
      serverId: 'brave-search',
      serverTemplate: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: {
          BRAVE_API_KEY: '{{secrets.BRAVE_API_KEY}}',
        },
      },
    },
  },
  remoteMcpConnector({
    id: 'notion',
    displayName: 'Notion',
    description: 'Connect a Notion-compatible remote MCP endpoint for pages, databases, and workspace context.',
    category: 'docs',
    tags: ['notion', 'docs', 'workspace'],
  }),
  remoteMcpConnector({
    id: 'slack',
    displayName: 'Slack',
    description: 'Connect a Slack-compatible remote MCP endpoint for workspace messages and actions.',
    category: 'automation',
    tags: ['slack', 'messages', 'work'],
  }),
  remoteMcpConnector({
    id: 'linear',
    displayName: 'Linear',
    description: 'Connect a Linear-compatible remote MCP endpoint for issues, projects, and triage workflows.',
    category: 'code',
    tags: ['linear', 'issues', 'work'],
  }),
  remoteMcpConnector({
    id: 'google-drive',
    displayName: 'Google Drive',
    description: 'Connect a Google Drive-compatible remote MCP endpoint for documents and shared files.',
    category: 'docs',
    tags: ['google', 'drive', 'docs'],
  }),
];
