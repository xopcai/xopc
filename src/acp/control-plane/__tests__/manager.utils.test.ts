/**
 * ACP Manager Utils Tests
 */

import { describe, it, expect } from "vitest";
import {
  normalizeActorKey,
  normalizeSessionKey,
  isAcpSessionKey,
  resolveAcpAgentFromSessionKey,
  resolveRuntimeIdleTtlMs,
  requireReadySessionMeta,
  resolveAcpSessionResolutionError,
  resolveMissingMetaError,
} from "../manager.utils.js";
import { AcpRuntimeError } from "../../runtime/errors.js";
import type { SessionAcpMeta, AcpSessionResolution } from "../../runtime/types.js";
import type { Config } from "../../config/schema.js";

describe("acp-manager-utils", () => {
  describe("normalizeActorKey", () => {
    it("should trim whitespace and convert to lowercase", () => {
      expect(normalizeActorKey("  Test-Key  ")).toBe("test-key");
    });

    it("should handle empty string", () => {
      expect(normalizeActorKey("")).toBe("");
    });

    it("should handle special characters", () => {
      expect(normalizeActorKey("Key@#$%")).toBe("key@#$%");
    });
  });

  describe("normalizeSessionKey", () => {
    it("should trim whitespace", () => {
      expect(normalizeSessionKey("  session-key  ")).toBe("session-key");
    });

    it("should preserve case", () => {
      expect(normalizeSessionKey("Session-Key")).toBe("Session-Key");
    });

    it("should handle empty string", () => {
      expect(normalizeSessionKey("")).toBe("");
    });
  });

  describe("isAcpSessionKey", () => {
    it("should return true for keys containing :acp:", () => {
      expect(isAcpSessionKey("agent:test:acp:uuid")).toBe(true);
      expect(isAcpSessionKey("test:acp:session")).toBe(true);
    });

    it("should return false for non-ACP keys", () => {
      expect(isAcpSessionKey("regular-session-key")).toBe(false);
      expect(isAcpSessionKey("agent:test")).toBe(false);
    });

    it("should handle empty string", () => {
      expect(isAcpSessionKey("")).toBe(false);
    });
  });

  describe("resolveAcpAgentFromSessionKey", () => {
    it("should extract agent from session key", () => {
      expect(resolveAcpAgentFromSessionKey("agent:claude:acp:uuid", "default")).toBe("claude");
      expect(resolveAcpAgentFromSessionKey("agent:gpt4:acp:123", "default")).toBe("gpt4");
    });

    it("should return default when format doesn't match", () => {
      expect(resolveAcpAgentFromSessionKey("regular-key", "default")).toBe("default");
      expect(resolveAcpAgentFromSessionKey("", "default")).toBe("default");
    });
  });

  describe("resolveRuntimeIdleTtlMs", () => {
    const createConfig = (ttlMinutes?: number): Config => {
      const config: Config = {
        version: "1.0.0",
        providers: {},
        agents: { defaults: { model: "test" } },
        channels: {},
      };

      if (ttlMinutes !== undefined) {
        (config as any).acp = { runtime: { ttlMinutes } };
      }

      return config;
    };

    it("should return 0 when ttlMinutes not configured", () => {
      const config = createConfig();
      expect(resolveRuntimeIdleTtlMs(config)).toBe(0);
    });

    it("should convert minutes to milliseconds", () => {
      const config = createConfig(5);
      expect(resolveRuntimeIdleTtlMs(config)).toBe(5 * 60 * 1000);
    });

    it("should return 0 for negative values", () => {
      const config = createConfig(-5);
      expect(resolveRuntimeIdleTtlMs(config)).toBe(0);
    });

    it("should return 0 for non-numeric values", () => {
      const config = createConfig() as any;
      config.acp = { runtime: { ttlMinutes: "invalid" } as any };
      expect(resolveRuntimeIdleTtlMs(config)).toBe(0);
    });

    it("should handle zero", () => {
      const config = createConfig(0);
      expect(resolveRuntimeIdleTtlMs(config)).toBe(0);
    });
  });

  describe("requireReadySessionMeta", () => {
    it("should return meta for ready resolution", () => {
      const meta: SessionAcpMeta = {
        backend: "test",
        agent: "test-agent",
        runtimeSessionName: "test-session",
        mode: "persistent",
        state: "idle",
        lastActivityAt: Date.now(),
      };

      const resolution: AcpSessionResolution = {
        kind: "ready",
        sessionKey: "test",
        meta,
      };

      const result = requireReadySessionMeta(resolution);
      expect(result).toBe(meta);
    });

    it("should throw for stale resolution", () => {
      const resolution: AcpSessionResolution = {
        kind: "stale",
        sessionKey: "test",
        error: new Error("Stale session"),
      };

      expect(() => requireReadySessionMeta(resolution)).toThrow(AcpRuntimeError);
    });

    it("should throw for none resolution", () => {
      const resolution: AcpSessionResolution = {
        kind: "none",
        sessionKey: "test",
      };

      expect(() => requireReadySessionMeta(resolution)).toThrow(AcpRuntimeError);
    });
  });

  describe("resolveAcpSessionResolutionError", () => {
    it("should return error for ready resolution", () => {
      const resolution: AcpSessionResolution = {
        kind: "ready",
        sessionKey: "test",
        meta: {
          backend: "test",
          agent: "test-agent",
          runtimeSessionName: "test-session",
          mode: "persistent",
          state: "idle",
          lastActivityAt: Date.now(),
        },
      };

      const error = resolveAcpSessionResolutionError(resolution);
      expect(error).toBeInstanceOf(AcpRuntimeError);
      expect(error.code).toBe("ACP_SESSION_INIT_FAILED");
    });

    it("should preserve existing AcpRuntimeError for stale resolution", () => {
      const originalError = new AcpRuntimeError("ACP_BACKEND_UNAVAILABLE", "Backend unavailable");
      const resolution: AcpSessionResolution = {
        kind: "stale",
        sessionKey: "test",
        error: originalError,
      };

      const error = resolveAcpSessionResolutionError(resolution);
      expect(error).toBe(originalError);
    });

    it("should wrap plain error for stale resolution", () => {
      const resolution: AcpSessionResolution = {
        kind: "stale",
        sessionKey: "test",
        error: new Error("Plain error"),
      };

      const error = resolveAcpSessionResolutionError(resolution);
      expect(error).toBeInstanceOf(AcpRuntimeError);
      expect(error.message).toBe("Plain error");
    });

    it("should create error for none resolution", () => {
      const resolution: AcpSessionResolution = {
        kind: "none",
        sessionKey: "test-session-key",
      };

      const error = resolveAcpSessionResolutionError(resolution);
      expect(error).toBeInstanceOf(AcpRuntimeError);
      expect(error.message).toContain("test-session-key");
    });
  });

  describe("resolveMissingMetaError", () => {
    it("should create error with session key", () => {
      const error = resolveMissingMetaError("test-session");

      expect(error).toBeInstanceOf(AcpRuntimeError);
      expect(error.code).toBe("ACP_SESSION_INIT_FAILED");
      expect(error.message).toContain("test-session");
    });
  });
});
