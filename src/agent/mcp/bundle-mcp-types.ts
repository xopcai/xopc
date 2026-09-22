import type { CallToolResult, ReadResourceResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import type { Config } from "../../config/schema.js";

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
  annotations?: ToolAnnotations;
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
  conversationId?: string;
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
  readResource: (serverName: string, uri: string, signal?: AbortSignal) => Promise<ReadResourceResult>;
  dispose: () => Promise<void>;
};

export type SessionMcpRuntimeManager = {
  getOrCreate: (params: {
    sessionId: string;
    conversationId?: string;
    workspaceDir: string;
    cfg?: Config;
  }) => Promise<SessionMcpRuntime>;
  bindConversationId: (conversationId: string, sessionId: string) => void;
  resolveSessionId: (conversationId: string) => string | undefined;
  disposeSession: (sessionId: string) => Promise<void>;
  disposeAll: () => Promise<void>;
  sweepIdleRuntimes: () => Promise<number>;
  listSessionIds: () => string[];
};
