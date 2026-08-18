import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import type { Config } from "../../config/schema.js";
import type { AgentTool as AnyAgentTool } from "@earendil-works/pi-agent-core";

export type BundleMcpToolRuntime = {
  tools: AnyAgentTool[];
  dispose: () => Promise<void>;
};

export type McpServerCatalog = {
  serverName: string;
  launchSummary: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
};

export type McpCatalogTool = {
  serverName: string;
  safeServerName: string;
  toolName: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchemaType;
  fallbackDescription: string;
};

export type McpCatalogResource = {
  serverName: string;
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type McpCatalogPrompt = {
  serverName: string;
  name: string;
  title?: string;
  description?: string;
  argumentCount: number;
};

export type McpToolCatalog = {
  version: number;
  generatedAt: number;
  servers: Record<string, McpServerCatalog>;
  tools: McpCatalogTool[];
  resources: McpCatalogResource[];
  prompts: McpCatalogPrompt[];
};

export type SessionMcpRuntime = {
  sessionId: string;
  sessionKey?: string;
  workspaceDir: string;
  configFingerprint: string;
  createdAt: number;
  lastUsedAt: number;
  activeLeases?: number;
  acquireLease?: () => () => void;
  getCatalog: () => Promise<McpToolCatalog>;
  markUsed: () => void;
  callTool: (
    serverName: string,
    toolName: string,
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>;
  dispose: () => Promise<void>;
};

export type SessionMcpRuntimeManager = {
  getOrCreate: (params: {
    sessionId: string;
    sessionKey?: string;
    workspaceDir: string;
    cfg?: Config;
  }) => Promise<SessionMcpRuntime>;
  bindSessionKey: (sessionKey: string, sessionId: string) => void;
  resolveSessionId: (sessionKey: string) => string | undefined;
  disposeSession: (sessionId: string) => Promise<void>;
  disposeAll: () => Promise<void>;
  sweepIdleRuntimes: () => Promise<number>;
  listSessionIds: () => string[];
};
