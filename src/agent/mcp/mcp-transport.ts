import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fetch as undiciFetch } from "undici";
import type { Config } from "../../config/schema.js";
import { resolveStateDir } from "../../config/paths-state.js";
import { buildRuntimeEnvironment, resolveRuntimeCommand } from "../../runtime-tools/environment.js";
import { createLogger } from "../../utils/logger.js";
const log = createLogger("Mcp:Transport");
import { normalizeOptionalString } from "../../utils/string-coerce.js";
import { XopcStdioClientTransport } from "./mcp-stdio-transport.js";
import { resolveMcpTransportConfig } from "./mcp-transport-config.js";
import { XopcMcpOAuthClientProvider } from "./oauth/mcp-oauth-provider.js";
import { McpOAuthStore } from "./oauth/mcp-oauth-store.js";

export type ResolvedMcpTransport = {
  transport: Transport;
  description: string;
  transportType: "stdio" | "sse" | "streamable-http";
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  detachStderr?: () => void;
};

function attachStderrLogging(serverName: string, transport: XopcStdioClientTransport) {
  const stderr = transport.stderr;
  if (!stderr || typeof stderr.on !== "function") {
    return undefined;
  }
  const onData = (chunk: Buffer | string) => {
    const message =
      normalizeOptionalString(typeof chunk === "string" ? chunk : String(chunk)) ?? "";
    if (!message) {
      return;
    }
    for (const line of message.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        log.debug(`bundle-mcp:${serverName}: ${trimmed}`);
      }
    }
  };
  stderr.on("data", onData);
  return () => {
    if (typeof stderr.off === "function") {
      stderr.off("data", onData);
    } else if (typeof stderr.removeListener === "function") {
      stderr.removeListener("data", onData);
    }
  };
}

type SseEventSourceFetch = NonNullable<
  NonNullable<SSEClientTransportOptions["eventSourceInit"]>["fetch"]
>;

const fetchWithUndici: FetchLike = async (url, init) =>
  (await undiciFetch(url, init as unknown as Parameters<typeof undiciFetch>[1])) as unknown as Response;

function buildSseEventSourceFetch(headers: Record<string, string>): SseEventSourceFetch {
  return (url: string | URL, init?: RequestInit) => {
    const sdkHeaders: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          sdkHeaders[key] = value;
        });
      } else {
        Object.assign(sdkHeaders, init.headers);
      }
    }
    return fetchWithUndici(url, {
      ...(init as RequestInit),
      headers: { ...sdkHeaders, ...headers },
    }) as ReturnType<SseEventSourceFetch>;
  };
}

function buildScopedHttpFetch(serverUrl: URL, headers: Record<string, string>): FetchLike {
  return async (url, init) => {
    const mergedHeaders = new Headers();
    if (new URL(url).origin === serverUrl.origin) {
      for (const [key, value] of Object.entries(headers)) mergedHeaders.set(key, value);
    }
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => mergedHeaders.set(key, value));
    }
    return fetchWithUndici(url, {
      ...init,
      headers: mergedHeaders,
    });
  };
}

export type ResolveMcpTransportOptions = {
  oauthProvider?: OAuthClientProvider;
  oauthStore?: McpOAuthStore;
};

export async function resolveMcpTransport(
  serverName: string,
  rawServer: unknown,
  config?: Config,
  options: ResolveMcpTransportOptions = {},
): Promise<ResolvedMcpTransport | null> {
  const resolved = resolveMcpTransportConfig(serverName, rawServer);
  if (!resolved) {
    return null;
  }
  if (resolved.kind === "stdio") {
    const command = config
      ? await resolveRuntimeCommand({
          command: resolved.command,
          stateDir: resolveStateDir(),
          config: config.runtimeTools,
          allowProvision: true,
        })
      : resolved.command;
    const env = config
      ? (await buildRuntimeEnvironment({
          stateDir: resolveStateDir(),
          config: config.runtimeTools,
          baseEnv: { ...getDefaultEnvironment(), ...resolved.env },
        })).env
      : resolved.env;
    const transport = new XopcStdioClientTransport({
      command,
      args: resolved.args,
      env,
      cwd: resolved.cwd,
      stderr: "pipe",
    });
    return {
      transport,
      description: command === resolved.command
        ? resolved.description
        : `${command}${resolved.args?.length ? ` ${resolved.args.join(' ')}` : ''}`,
      transportType: "stdio",
      connectionTimeoutMs: resolved.connectionTimeoutMs,
      requestTimeoutMs: resolved.requestTimeoutMs,
      detachStderr: attachStderrLogging(serverName, transport),
    };
  }
  if (resolved.transportType === "streamable-http") {
    const serverUrl = new URL(resolved.url);
    const oauthEnabled = Boolean(resolved.auth);
    let oauthProvider = options.oauthProvider;
    if (resolved.auth && !oauthProvider) {
      const store = options.oauthStore ?? new McpOAuthStore();
      const record = await store.load(serverUrl);
      if (record?.tokens) {
        oauthProvider = new XopcMcpOAuthClientProvider({
          serverUrl,
          clientId: resolved.auth.clientId,
          store,
        });
      }
    }
    return {
      transport: new StreamableHTTPClientTransport(serverUrl, {
        authProvider: oauthProvider,
        requestInit: !oauthEnabled && resolved.headers ? { headers: resolved.headers } : undefined,
        fetch: oauthEnabled
          ? buildScopedHttpFetch(serverUrl, resolved.headers ?? {})
          : fetchWithUndici,
      }),
      description: resolved.description,
      transportType: "streamable-http",
      connectionTimeoutMs: resolved.connectionTimeoutMs,
      requestTimeoutMs: resolved.requestTimeoutMs,
    };
  }
  const headers: Record<string, string> = {
    ...resolved.headers,
  };
  const hasHeaders = Object.keys(headers).length > 0;
  return {
    transport: new SSEClientTransport(new URL(resolved.url), {
      requestInit: hasHeaders ? { headers } : undefined,
      fetch: fetchWithUndici,
      eventSourceInit: { fetch: buildSseEventSourceFetch(headers) },
    }),
    description: resolved.description,
    transportType: "sse",
    connectionTimeoutMs: resolved.connectionTimeoutMs,
    requestTimeoutMs: resolved.requestTimeoutMs,
  };
}
