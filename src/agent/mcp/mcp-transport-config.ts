import { resolveXopcMcpTransportAlias } from "../../config/mcp-config-normalize.js";
import { createLogger } from "../../utils/logger.js";
const log = createLogger("BundleMcp");
import { normalizeLowercaseStringOrEmpty } from "../../utils/string-coerce.js";
import { sanitizeForLog } from "../../utils/sanitize-log.js";
import {
  describeHttpMcpServerLaunchConfig,
  resolveHttpMcpServerLaunchConfig,
  type HttpMcpTransportType,
} from "./mcp-http.js";
import {
  describeStdioMcpServerLaunchConfig,
  resolveStdioMcpServerLaunchConfig,
} from "./mcp-stdio.js";

type ResolvedBaseMcpTransportConfig = {
  description: string;
  connectionTimeoutMs: number;
};

export type ResolvedStdioMcpTransportConfig = ResolvedBaseMcpTransportConfig & {
  kind: "stdio";
  transportType: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type ResolvedHttpMcpTransportConfig = ResolvedBaseMcpTransportConfig & {
  kind: "http";
  transportType: HttpMcpTransportType;
  url: string;
  headers?: Record<string, string>;
};

export type ResolvedMcpTransportConfig =
  | ResolvedStdioMcpTransportConfig
  | ResolvedHttpMcpTransportConfig;

const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

function getConnectionTimeoutMs(rawServer: unknown): number {
  if (
    rawServer &&
    typeof rawServer === "object" &&
    typeof (rawServer as { connectionTimeoutMs?: unknown }).connectionTimeoutMs === "number" &&
    (rawServer as { connectionTimeoutMs: number }).connectionTimeoutMs > 0
  ) {
    return (rawServer as { connectionTimeoutMs: number }).connectionTimeoutMs;
  }
  return DEFAULT_CONNECTION_TIMEOUT_MS;
}

function getRequestedTransport(rawServer: unknown): string {
  if (
    !rawServer ||
    typeof rawServer !== "object" ||
    typeof (rawServer as { transport?: unknown }).transport !== "string"
  ) {
    return "";
  }
  return normalizeLowercaseStringOrEmpty((rawServer as { transport?: string }).transport);
}

function getRequestedTransportAlias(rawServer: unknown): HttpMcpTransportType | "" {
  if (
    !rawServer ||
    typeof rawServer !== "object" ||
    typeof (rawServer as { type?: unknown }).type !== "string"
  ) {
    return "";
  }
  return resolveXopcMcpTransportAlias((rawServer as { type?: string }).type) ?? "";
}

function resolveHttpTransportConfig(
  serverName: string,
  rawServer: unknown,
  transportType: HttpMcpTransportType,
): ResolvedHttpMcpTransportConfig | null {
  const launch = resolveHttpMcpServerLaunchConfig(rawServer, {
    transportType,
    onDroppedHeader: (key) => {
      log.warn(
        `bundle-mcp: server "${serverName}": header "${key}" has an unsupported value type and was ignored.`,
      );
    },
    onMalformedHeaders: () => {
      log.warn(
        `bundle-mcp: server "${serverName}": "headers" must be a JSON object; the value was ignored.`,
      );
    },
  });
  if (!launch.ok) {
    return null;
  }
  return {
    kind: "http",
    transportType: launch.config.transportType,
    url: launch.config.url,
    headers: launch.config.headers,
    description: describeHttpMcpServerLaunchConfig(launch.config),
    connectionTimeoutMs: getConnectionTimeoutMs(rawServer),
  };
}

export function resolveMcpTransportConfig(
  serverName: string,
  rawServer: unknown,
): ResolvedMcpTransportConfig | null {
  const logServerName = sanitizeForLog(serverName);
  const requestedTransport = getRequestedTransport(rawServer);
  const requestedTransportAlias = requestedTransport ? "" : getRequestedTransportAlias(rawServer);
  const effectiveTransport = requestedTransport || requestedTransportAlias;
  const stdioLaunch = resolveStdioMcpServerLaunchConfig(rawServer, {
    onDroppedEnv: (key) => {
      log.warn(
        `bundle-mcp: server "${logServerName}": env "${sanitizeForLog(key)}" is blocked for stdio startup safety and was ignored.`,
      );
    },
  });
  if (stdioLaunch.ok) {
    return {
      kind: "stdio",
      transportType: "stdio",
      command: stdioLaunch.config.command,
      args: stdioLaunch.config.args,
      env: stdioLaunch.config.env,
      cwd: stdioLaunch.config.cwd,
      description: describeStdioMcpServerLaunchConfig(stdioLaunch.config),
      connectionTimeoutMs: getConnectionTimeoutMs(rawServer),
    };
  }

  if (
    effectiveTransport &&
    effectiveTransport !== "sse" &&
    effectiveTransport !== "streamable-http"
  ) {
    log.warn(
      `bundle-mcp: skipped server "${logServerName}" because transport "${sanitizeForLog(effectiveTransport)}" is not supported.`,
    );
    return null;
  }

  if (effectiveTransport === "streamable-http") {
    const httpTransport = resolveHttpTransportConfig(serverName, rawServer, "streamable-http");
    if (httpTransport) {
      return httpTransport;
    }
  }

  const sseTransport = resolveHttpTransportConfig(serverName, rawServer, "sse");
  if (sseTransport) {
    return sseTransport;
  }

  const stdioReason =
    stdioLaunch.ok === false ? stdioLaunch.reason : 'not a stdio server';
  const httpLaunch = resolveHttpMcpServerLaunchConfig(rawServer);
  const httpReason =
    httpLaunch.ok === false ? httpLaunch.reason : 'not an HTTP MCP server';
  log.warn(
    `bundle-mcp: skipped server "${logServerName}" because ${stdioReason} and ${httpReason}.`,
  );
  return null;
}
