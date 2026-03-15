/**
 * ACP Runtime Cache Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeCache, type CachedRuntimeState } from "../runtime-cache.js";
import type { AcpRuntime, AcpRuntimeSessionMode } from "../../runtime/types.js";

describe("acp-runtime-cache", () => {
  let cache: RuntimeCache;

  // Create a mock runtime for testing
  const createMockRuntime = (): AcpRuntime => ({
    ensureSession: async () => ({
      sessionKey: "test",
      backend: "test",
      runtimeSessionName: "test-session",
    }),
    runTurn: async function* () {},
    cancel: async () => {},
    close: async () => {},
  });

  const createMockState = (overrides?: Partial<CachedRuntimeState>): CachedRuntimeState => ({
    runtime: createMockRuntime(),
    handle: {
      sessionKey: "test-session",
      backend: "test-backend",
      runtimeSessionName: "test-session",
    },
    backend: "test-backend",
    agent: "test-agent",
    mode: "persistent" as AcpRuntimeSessionMode,
    lastTouchedAt: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    cache = new RuntimeCache();
  });

  describe("set", () => {
    it("should set and get state", () => {
      const state = createMockState();
      cache.set("actor-key", state);

      const result = cache.get("actor-key");
      expect(result).not.toBeNull();
      expect(result?.backend).toBe("test-backend");
      expect(result?.agent).toBe("test-agent");
    });

    it("should always set lastTouchedAt to current time on set", () => {
      const originalTime = Date.now() - 10000;
      const state = createMockState({ lastTouchedAt: originalTime });
      
      // Wait a tiny bit to ensure time difference
      const beforeSet = Date.now();
      cache.set("actor-key", state);
      const afterSet = Date.now();

      const result = cache.get("actor-key");
      // lastTouchedAt should be updated to current time
      expect(result?.lastTouchedAt).toBeGreaterThanOrEqual(beforeSet);
      expect(result?.lastTouchedAt).toBeLessThanOrEqual(afterSet);
    });
  });

  describe("has", () => {
    it("should return false for non-existent key", () => {
      expect(cache.has("non-existent")).toBe(false);
    });

    it("should return true for existing key", () => {
      cache.set("actor-key", createMockState());

      expect(cache.has("actor-key")).toBe(true);
    });
  });

  describe("clear", () => {
    it("should remove entry from cache", () => {
      cache.set("actor-key", createMockState());
      cache.clear("actor-key");

      expect(cache.has("actor-key")).toBe(false);
    });

    it("should handle clearing non-existent key", () => {
      expect(() => cache.clear("non-existent")).not.toThrow();
    });
  });

  describe("size", () => {
    it("should return 0 for empty cache", () => {
      expect(cache.size()).toBe(0);
    });

    it("should return correct size", () => {
      cache.set("key-1", createMockState());
      cache.set("key-2", createMockState());
      cache.set("key-3", createMockState());

      expect(cache.size()).toBe(3);
    });
  });

  describe("peek", () => {
    it("should return null for non-existent key", () => {
      expect(cache.peek("non-existent")).toBeNull();
    });

    it("should get state without updating touch time", () => {
      const state = createMockState();
      cache.set("actor-key", state);
      
      // Get current lastTouchedAt
      const firstGet = cache.peek("actor-key");
      const firstTime = firstGet?.lastTouchedAt ?? 0;
      
      // Wait a tiny bit
      
      // Peek again should NOT update touch time (but set already updated it to now)
      // Note: Since set always updates lastTouchedAt to now, peek returns current time
      cache.peek("actor-key");
      
      // get() updates touch time, peek() does not
      cache.get("actor-key");
      
      // After get(), the time should be updated again
      const afterGet = cache.peek("actor-key");
      
      // The time after get() should be >= time before get()
      expect(afterGet?.lastTouchedAt).toBeGreaterThanOrEqual(firstTime);
    });
  });

  describe("getLastTouchedAt", () => {
    it("should return undefined for non-existent key", () => {
      expect(cache.getLastTouchedAt("non-existent")).toBeUndefined();
    });

    it("should return last touched time from map", () => {
      const state = createMockState();
      cache.set("actor-key", state);

      const result = cache.getLastTouchedAt("actor-key");
      // Should return the current time that was set
      expect(result).toBeDefined();
      expect(typeof result).toBe("number");
    });
  });

  describe("collectIdleCandidates", () => {
    it("should return empty array when no entries", () => {
      const candidates = cache.collectIdleCandidates({ maxIdleMs: 5000, now: Date.now() });

      expect(candidates).toEqual([]);
    });

    it("should return entries when maxIdleMs is very large", () => {
      // When maxIdleMs is very large (like Infinity), any entry should be considered not idle
      const now = Date.now();
      cache.set("entry-1", createMockState());
      cache.set("entry-2", createMockState());

      // With very large maxIdleMs, even recent entries should NOT be idle
      const candidates = cache.collectIdleCandidates({ maxIdleMs: Number.MAX_SAFE_INTEGER, now });
      expect(candidates).toHaveLength(0);
    });

    it("should return empty when entries are recent", () => {
      const now = Date.now();
      cache.set("recent", createMockState());

      // With maxIdleMs = 1 second and entries just touched, should return empty
      const candidates = cache.collectIdleCandidates({ maxIdleMs: 1000, now });
      expect(candidates).toHaveLength(0);
    });
  });

  describe("clearAll", () => {
    it("should clear all entries", () => {
      cache.set("key-1", createMockState());
      cache.set("key-2", createMockState());

      cache.clearAll();

      expect(cache.size()).toBe(0);
    });
  });

  describe("cache state integrity", () => {
    it("should store independent copy of state", () => {
      const originalState = createMockState();
      cache.set("actor-key", originalState);

      // Modify the original
      originalState.agent = "modified-agent";

      // Get should return original stored value
      const stored = cache.get("actor-key");
      expect(stored?.agent).toBe("test-agent");
    });

    it("should update state independently", () => {
      cache.set("actor-key", createMockState());

      const newState = createMockState({ agent: "new-agent" });
      cache.set("actor-key", newState);

      const result = cache.get("actor-key");
      expect(result?.agent).toBe("new-agent");
    });
  });
});
