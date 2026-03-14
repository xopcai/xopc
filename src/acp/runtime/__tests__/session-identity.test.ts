/**
 * Session Identity Tests
 */

import { describe, it, expect } from "vitest";
import {
  createIdentityFromEnsure,
  createIdentityFromStatus,
  mergeSessionIdentity,
  identityEquals,
  isSessionIdentityPending,
  identityHasStableSessionId,
  resolveSessionIdentityFromMeta,
  resolveRuntimeHandleIdentifiersFromIdentity,
} from "../session-identity.js";
import type { SessionAcpMeta, AcpRuntimeHandle, AcpRuntimeStatus } from "../runtime/types.js";

describe("session-identity", () => {
  describe("createIdentityFromEnsure", () => {
    it("should create resolved identity when backendSessionId is present", () => {
      const handle: AcpRuntimeHandle = {
        sessionKey: "test",
        backend: "test-backend",
        runtimeSessionName: "test-session",
        backendSessionId: "session-123",
      };

      const identity = createIdentityFromEnsure({ handle, now: Date.now() });

      expect(identity).toBeDefined();
      expect(identity?.state).toBe("resolved");
      expect(identity?.acpxSessionId).toBe("session-123");
      expect(identity?.source).toBe("ensure");
    });

    it("should create resolved identity when agentSessionId is present", () => {
      const handle: AcpRuntimeHandle = {
        sessionKey: "test",
        backend: "test-backend",
        runtimeSessionName: "test-session",
        agentSessionId: "agent-456",
      };

      const identity = createIdentityFromEnsure({ handle, now: Date.now() });

      expect(identity).toBeDefined();
      expect(identity?.state).toBe("resolved");
      expect(identity?.agentSessionId).toBe("agent-456");
    });

    it("should create pending identity when only acpxRecordId is present", () => {
      const handle: AcpRuntimeHandle = {
        sessionKey: "test",
        backend: "test-backend",
        runtimeSessionName: "test-session",
        acpxRecordId: "record-789",
      };

      const identity = createIdentityFromEnsure({ handle, now: Date.now() });

      expect(identity).toBeDefined();
      expect(identity?.state).toBe("pending");
      expect(identity?.acpxRecordId).toBe("record-789");
    });

    it("should return undefined when no identifiers present", () => {
      const handle: AcpRuntimeHandle = {
        sessionKey: "test",
        backend: "test-backend",
        runtimeSessionName: "test-session",
      };

      const identity = createIdentityFromEnsure({ handle, now: Date.now() });

      expect(identity).toBeUndefined();
    });

    it("should trim whitespace from identifiers", () => {
      const handle: AcpRuntimeHandle = {
        sessionKey: "test",
        backend: "test-backend",
        runtimeSessionName: "test-session",
        backendSessionId: "  session-123  ",
        agentSessionId: "  agent-456  ",
      };

      const identity = createIdentityFromEnsure({ handle, now: Date.now() });

      expect(identity?.acpxSessionId).toBe("session-123");
      expect(identity?.agentSessionId).toBe("agent-456");
    });
  });

  describe("createIdentityFromStatus", () => {
    it("should create identity from status with backendSessionId", () => {
      const status: AcpRuntimeStatus = {
        summary: "running",
        backendSessionId: "status-session-123",
      };

      const identity = createIdentityFromStatus({ status, now: Date.now() });

      expect(identity).toBeDefined();
      expect(identity?.state).toBe("resolved");
      expect(identity?.acpxSessionId).toBe("status-session-123");
      expect(identity?.source).toBe("status");
    });

    it("should extract identifiers from status details", () => {
      const status: AcpRuntimeStatus = {
        summary: "running",
        details: {
          backendSessionId: "detail-session-456",
          agentSessionId: "detail-agent-789",
        },
      };

      const identity = createIdentityFromStatus({ status, now: Date.now() });

      expect(identity).toBeDefined();
      expect(identity?.acpxSessionId).toBe("detail-session-456");
      expect(identity?.agentSessionId).toBe("detail-agent-789");
    });

    it("should return undefined when status is undefined", () => {
      const identity = createIdentityFromStatus({ status: undefined, now: Date.now() });

      expect(identity).toBeUndefined();
    });

    it("should return undefined when no identifiers in status", () => {
      const status: AcpRuntimeStatus = {
        summary: "running",
      };

      const identity = createIdentityFromStatus({ status, now: Date.now() });

      expect(identity).toBeUndefined();
    });
  });

  describe("mergeSessionIdentity", () => {
    it("should use incoming when current is undefined", () => {
      const incoming: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now(),
      };

      const result = mergeSessionIdentity({
        current: undefined,
        incoming,
        now: Date.now(),
      });

      expect(result).toEqual(incoming);
    });

    it("should keep current when incoming is undefined", () => {
      const current: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now(),
      };

      const result = mergeSessionIdentity({
        current,
        incoming: undefined,
        now: Date.now(),
      });

      expect(result).toEqual(current);
    });

    it("should use incoming when it is resolved", () => {
      const current: SessionAcpMeta["identity"] = {
        state: "pending",
        source: "ensure",
        acpxRecordId: "record-1",
        lastUpdatedAt: Date.now() - 1000,
      };

      const incoming: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "status",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now(),
      };

      const result = mergeSessionIdentity({
        current,
        incoming,
        now: Date.now(),
      });

      expect(result?.state).toBe("resolved");
      expect(result?.acpxSessionId).toBe("session-123");
    });

    it("should keep current resolved when incoming is pending", () => {
      const current: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now() - 1000,
      };

      const incoming: SessionAcpMeta["identity"] = {
        state: "pending",
        source: "status",
        acpxRecordId: "record-456",
        lastUpdatedAt: Date.now(),
      };

      const result = mergeSessionIdentity({
        current,
        incoming,
        now: Date.now(),
      });

      expect(result?.state).toBe("resolved");
      expect(result?.acpxSessionId).toBe("session-123");
    });

    it("should return undefined when both are undefined", () => {
      const result = mergeSessionIdentity({
        current: undefined,
        incoming: undefined,
        now: Date.now(),
      });

      expect(result).toBeUndefined();
    });
  });

  describe("identityEquals", () => {
    it("should return true for same identity", () => {
      const identity: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now(),
      };

      expect(identityEquals(identity, identity)).toBe(true);
    });

    it("should return true for equal identities", () => {
      const a: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now(),
      };

      const b: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now(),
      };

      expect(identityEquals(a, b)).toBe(true);
    });

    it("should return false for different states", () => {
      const a: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now(),
      };

      const b: SessionAcpMeta["identity"] = {
        state: "pending",
        source: "ensure",
        lastUpdatedAt: Date.now(),
      };

      expect(identityEquals(a, b)).toBe(false);
    });

    it("should return true for both undefined", () => {
      expect(identityEquals(undefined, undefined)).toBe(true);
    });

    it("should return false when one is undefined", () => {
      const identity: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        lastUpdatedAt: Date.now(),
      };

      expect(identityEquals(identity, undefined)).toBe(false);
      expect(identityEquals(undefined, identity)).toBe(false);
    });
  });

  describe("isSessionIdentityPending", () => {
    it("should return true for pending identity", () => {
      const identity: SessionAcpMeta["identity"] = {
        state: "pending",
        source: "ensure",
        lastUpdatedAt: Date.now(),
      };

      expect(isSessionIdentityPending(identity)).toBe(true);
    });

    it("should return false for resolved identity", () => {
      const identity: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now(),
      };

      expect(isSessionIdentityPending(identity)).toBe(false);
    });

    it("should return true for undefined identity", () => {
      expect(isSessionIdentityPending(undefined)).toBe(true);
    });
  });

  describe("identityHasStableSessionId", () => {
    it("should return true when acpxSessionId present", () => {
      const identity: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "status",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now(),
      };

      expect(identityHasStableSessionId(identity)).toBe(true);
    });

    it("should return true when agentSessionId present", () => {
      const identity: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "status",
        agentSessionId: "agent-456",
        lastUpdatedAt: Date.now(),
      };

      // agentSessionId is also considered a stable session ID
      expect(identityHasStableSessionId(identity)).toBe(true);
    });

    it("should return false when only acpxRecordId present", () => {
      const identity: SessionAcpMeta["identity"] = {
        state: "pending",
        source: "ensure",
        acpxRecordId: "record-789",
        lastUpdatedAt: Date.now(),
      };

      expect(identityHasStableSessionId(identity)).toBe(false);
    });

    it("should return false for undefined identity", () => {
      expect(identityHasStableSessionId(undefined)).toBe(false);
    });
  });

  describe("resolveSessionIdentityFromMeta", () => {
    it("should extract identity from meta", () => {
      const meta: SessionAcpMeta = {
        backend: "test",
        agent: "test-agent",
        runtimeSessionName: "test-session",
        mode: "persistent",
        state: "idle",
        lastActivityAt: Date.now(),
        identity: {
          state: "resolved",
          source: "ensure",
          acpxSessionId: "session-123",
          lastUpdatedAt: Date.now(),
        },
      };

      const identity = resolveSessionIdentityFromMeta(meta);

      expect(identity).toBeDefined();
      expect(identity?.acpxSessionId).toBe("session-123");
    });

    it("should return undefined for undefined meta", () => {
      expect(resolveSessionIdentityFromMeta(undefined)).toBeUndefined();
    });
  });

  describe("resolveRuntimeHandleIdentifiersFromIdentity", () => {
    it("should extract backendSessionId", () => {
      const identity: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        acpxSessionId: "session-123",
        lastUpdatedAt: Date.now(),
      };

      const result = resolveRuntimeHandleIdentifiersFromIdentity(identity);

      expect(result.backendSessionId).toBe("session-123");
    });

    it("should extract agentSessionId", () => {
      const identity: SessionAcpMeta["identity"] = {
        state: "resolved",
        source: "ensure",
        agentSessionId: "agent-456",
        lastUpdatedAt: Date.now(),
      };

      const result = resolveRuntimeHandleIdentifiersFromIdentity(identity);

      expect(result.agentSessionId).toBe("agent-456");
    });

    it("should return empty object for undefined identity", () => {
      const result = resolveRuntimeHandleIdentifiersFromIdentity(undefined);

      expect(result).toEqual({});
    });
  });
});
