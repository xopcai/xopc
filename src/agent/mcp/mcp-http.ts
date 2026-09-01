import {
  redactSensitiveUrl,
  redactSensitiveUrlLikeString,
} from "../../utils/redact-sensitive-url.js";
import { isMcpConfigRecord, toMcpStringRecord } from "./mcp-config-shared.js";

export type HttpMcpTransportType = "sse" | "streamable-http";

export type HttpMcpServerLaunchConfig = {
  transportType: HttpMcpTransportType;
  url: string;
  headers?: Record<string, string>;
  auth?: {
    type: "oauth";
    clientId?: string;
  };
};

export type HttpMcpServerLaunchResult =
  | { ok: true; config: HttpMcpServerLaunchConfig }
  | { ok: false; reason: string };

export function resolveHttpMcpServerLaunchConfig(
  raw: unknown,
  options?: {
    transportType?: HttpMcpTransportType;
    onDroppedHeader?: (key: string, value: unknown) => void;
    onMalformedHeaders?: (value: unknown) => void;
  },
): HttpMcpServerLaunchResult {
  if (!isMcpConfigRecord(raw)) {
    return { ok: false, reason: "server config must be an object" };
  }
  if (typeof raw.url !== "string" || raw.url.trim().length === 0) {
    return { ok: false, reason: "its url is missing" };
  }
  const url = raw.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      reason: `its url is not a valid URL: ${redactSensitiveUrlLikeString(url)}`,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `only http and https URLs are supported, got ${parsed.protocol}`,
    };
  }

  let headers: Record<string, string> | undefined;
  if (raw.headers !== undefined && raw.headers !== null) {
    if (!isMcpConfigRecord(raw.headers)) {
      options?.onMalformedHeaders?.(raw.headers);
    } else {
      headers = toMcpStringRecord(raw.headers, {
        onDroppedEntry: options?.onDroppedHeader,
      });
    }
  }

  let auth: HttpMcpServerLaunchConfig["auth"];
  if (raw.auth !== undefined) {
    if (!isMcpConfigRecord(raw.auth) || raw.auth.type !== "oauth") {
      return { ok: false, reason: 'its auth must be { "type": "oauth" }' };
    }
    if (raw.auth.clientId !== undefined && (typeof raw.auth.clientId !== "string" || !raw.auth.clientId.trim())) {
      return { ok: false, reason: "its OAuth clientId must be a non-empty string" };
    }
    const transportType = options?.transportType ?? "streamable-http";
    if (transportType !== "streamable-http") {
      return { ok: false, reason: "OAuth supports streamable HTTP only" };
    }
    if (headers && Object.keys(headers).some((key) => key.toLowerCase() === "authorization")) {
      return { ok: false, reason: "OAuth cannot be combined with a static Authorization header" };
    }
    auth = {
      type: "oauth",
      ...(typeof raw.auth.clientId === "string" ? { clientId: raw.auth.clientId.trim() } : {}),
    };
  }

  return {
    ok: true,
    config: {
      transportType: options?.transportType ?? "streamable-http",
      url,
      headers,
      auth,
    },
  };
}

export function describeHttpMcpServerLaunchConfig(config: HttpMcpServerLaunchConfig): string {
  return redactSensitiveUrl(config.url);
}
