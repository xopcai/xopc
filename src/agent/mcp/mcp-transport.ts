import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { fetch as undiciFetch } from "undici";
import { createLogger } from "../../utils/logger.js";
const log = createLogger("Mcp:Transport");
import { normalizeOptionalString } from "../../utils/string-coerce.js";
import { XopcStdioClientTransport } from "./mcp-stdio-transport.js";
import { resolveMcpTransportConfig } from "./mcp-transport-config.js";

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

export function resolveMcpTransport(
  serverName: string,
  rawServer: unknown,
): ResolvedMcpTransport | null {
  const resolved = resolveMcpTransportConfig(serverName, rawServer);
  if (!resolved) {
    return null;
  }
  if (resolved.kind === "stdio") {
    const transport = new XopcStdioClientTransport({
      command: resolved.command,
      args: resolved.args,
      env: resolved.env,
      cwd: resolved.cwd,
      stderr: "pipe",
    });
    return {
      transport,
      description: resolved.description,
      transportType: "stdio",
      connectionTimeoutMs: resolved.connectionTimeoutMs,
      requestTimeoutMs: resolved.requestTimeoutMs,
      detachStderr: attachStderrLogging(serverName, transport),
    };
  }
  if (resolved.transportType === "streamable-http") {
    return {
      transport: new StreamableHTTPClientTransport(new URL(resolved.url), {
        requestInit: resolved.headers ? { headers: resolved.headers } : undefined,
        fetch: fetchWithUndici,
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
