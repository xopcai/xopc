/**
 * ACP Server Types
 */

import type { AcpSessionStore } from "./session.js";

/**
 * ACP Provenance mode
 */
export type AcpProvenanceMode = "off" | "meta" | "meta+receipt";

/**
 * ACP Server Options
 */
export interface AcpServerOptions {
  /** Gateway WebSocket URL */
  gatewayUrl?: string;
  /** Gateway auth token */
  gatewayToken?: string;
  /** Gateway auth password */
  gatewayPassword?: string;
  /** Default session key */
  defaultSessionKey?: string;
  /** Default session label */
  defaultSessionLabel?: string;
  /** Require existing session */
  requireExistingSession?: boolean;
  /** Reset session before use */
  resetSession?: boolean;
  /** Prefix prompts with cwd */
  prefixCwd?: boolean;
  /** Provenance mode */
  provenanceMode?: AcpProvenanceMode;
  /** Verbose logging */
  verbose?: boolean;
  /** Custom session store */
  sessionStore?: AcpSessionStore;
}

/**
 * Normalize provenance mode from string
 */
export function normalizeAcpProvenanceMode(value?: string): AcpProvenanceMode | undefined {
  if (!value) {
    return undefined;
  }
  
  const normalized = value.toLowerCase();
  if (normalized === "off" || normalized === "meta" || normalized === "meta+receipt") {
    return normalized;
  }
  return undefined;
}
