/**
 * ACP Session Store Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AcpSessionStore } from "../session-store.js";
import type { SessionAcpMeta } from "../manager.types.js";
import type { AcpRuntimeSessionMode } from "../runtime/types.js";
import { mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("AcpSessionStore", () => {
  let store: AcpSessionStore;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = join(tmpdir(), `acp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    store = new AcpSessionStore(testDir);
    await store.initialize();
  });

  describe("initialize", () => {
    it("should create sessions directory if not exists", async () => {
      const testDir2 = join(tmpdir(), `acp-test-init-${Date.now()}`);
      await mkdir(testDir2, { recursive: true });
      
      const store2 = new AcpSessionStore(testDir2);
      await store2.initialize();
      
      // Store should be initialized without error
      expect(store2).toBeDefined();
    });
  });

  describe("save and load", () => {
    it("should save and load a session entry", async () => {
      const sessionKey = "agent:test:acp:123";
      const meta: SessionAcpMeta = {
        backend: "test-backend",
        agent: "test-agent",
        runtimeSessionName: "test-session",
        mode: "persistent" as AcpRuntimeSessionMode,
        state: "idle",
        lastActivityAt: Date.now(),
      };

      await store.save(sessionKey, { sessionKey, acp: meta });
      const loaded = await store.load(sessionKey);

      expect(loaded).toBeDefined();
      expect(loaded?.sessionKey).toBe(sessionKey.toLowerCase());
      expect(loaded?.acp?.backend).toBe("test-backend");
    });

    it("should return null for non-existent session", async () => {
      const loaded = await store.load("non:existent:key");

      expect(loaded).toBeNull();
    });

    it("should handle case-insensitive session keys", async () => {
      const sessionKey = "Agent:Test:ACP:123";
      const meta: SessionAcpMeta = {
        backend: "test-backend",
        agent: "test-agent",
        runtimeSessionName: "test-session",
        mode: "persistent" as AcpRuntimeSessionMode,
        state: "idle",
        lastActivityAt: Date.now(),
      };

      await store.save(sessionKey, { sessionKey, acp: meta });
      const loaded = await store.load("AGENT:TEST:ACP:123");

      expect(loaded).toBeDefined();
    });

    it("should overwrite existing session", async () => {
      const sessionKey = "agent:test:acp:123";
      const meta1: SessionAcpMeta = {
        backend: "backend-1",
        agent: "agent-1",
        runtimeSessionName: "session-1",
        mode: "persistent" as AcpRuntimeSessionMode,
        state: "idle",
        lastActivityAt: Date.now(),
      };

      const meta2: SessionAcpMeta = {
        backend: "backend-2",
        agent: "agent-2",
        runtimeSessionName: "session-2",
        mode: "persistent" as AcpRuntimeSessionMode,
        state: "running",
        lastActivityAt: Date.now(),
      };

      await store.save(sessionKey, { sessionKey, acp: meta1 });
      await store.save(sessionKey, { sessionKey, acp: meta2 });

      const loaded = await store.load(sessionKey);
      expect(loaded?.acp?.backend).toBe("backend-2");
    });

    it("should trim whitespace from session keys", async () => {
      const sessionKey = "  agent:test:acp:123  ";
      const meta: SessionAcpMeta = {
        backend: "test-backend",
        agent: "test-agent",
        runtimeSessionName: "test-session",
        mode: "persistent" as AcpRuntimeSessionMode,
        state: "idle",
        lastActivityAt: Date.now(),
      };

      await store.save(sessionKey, { sessionKey, acp: meta });
      const loaded = await store.load("agent:test:acp:123");

      expect(loaded).toBeDefined();
    });
  });

  describe("list", () => {
    it("should list all sessions", async () => {
      const sessions = [
        { sessionKey: "agent:test:acp:1", acp: createMeta("backend-1", "agent-1") },
        { sessionKey: "agent:test:acp:2", acp: createMeta("backend-2", "agent-2") },
        { sessionKey: "agent:test:acp:3", acp: createMeta("backend-3", "agent-3") },
      ];

      for (const session of sessions) {
        await store.save(session.sessionKey, session);
      }

      const list = await store.list();

      expect(list).toHaveLength(3);
    });

    it("should return empty array when no sessions", async () => {
      const list = await store.list();

      expect(list).toHaveLength(0);
    });
  });

  describe("listAcpSessions", () => {
    it("should only return sessions with acp metadata", async () => {
      await store.save("agent:test:acp:1", { sessionKey: "agent:test:acp:1", acp: createMeta("b1", "a1") });
      await store.save("agent:test:acp:2", { sessionKey: "agent:test:acp:2" }); // No acp metadata
      await store.save("agent:test:acp:3", { sessionKey: "agent:test:acp:3", acp: createMeta("b3", "a3") });

      const list = await store.listAcpSessions();

      expect(list).toHaveLength(2);
    });
  });

  describe("delete", () => {
    it("should delete a session", async () => {
      const sessionKey = "agent:test:acp:123";
      await store.save(sessionKey, { sessionKey, acp: createMeta("b1", "a1") });

      await store.delete(sessionKey);
      const loaded = await store.load(sessionKey);

      expect(loaded).toBeNull();
    });

    it("should handle case-insensitive delete", async () => {
      const sessionKey = "Agent:Test:Acp:123";
      await store.save(sessionKey, { sessionKey, acp: createMeta("b1", "a1") });

      await store.delete("AGENT:TEST:ACP:123");
      const loaded = await store.load(sessionKey);

      expect(loaded).toBeNull();
    });

    it("should not error when deleting non-existent session", async () => {
      await store.delete("non:existent:key");
      // Should not throw
    });
  });

  describe("clear", () => {
    it("should clear all sessions", async () => {
      await store.save("agent:test:acp:1", { sessionKey: "agent:test:acp:1", acp: createMeta("b1", "a1") });
      await store.save("agent:test:acp:2", { sessionKey: "agent:test:acp:2", acp: createMeta("b2", "a2") });

      await store.clear();

      const list = await store.list();
      expect(list).toHaveLength(0);
    });
  });

  describe("persistence", () => {
    it("should persist sessions across store instances", async () => {
      const sessionKey = "agent:test:acp:123";
      const meta = createMeta("backend", "agent");

      await store.save(sessionKey, { sessionKey, acp: meta });

      // Create a new store instance with the same directory
      const store2 = new AcpSessionStore(testDir);
      await store2.initialize();

      const loaded = await store2.load(sessionKey);

      expect(loaded).toBeDefined();
      expect(loaded?.acp?.backend).toBe("backend");
    });
  });
});

function createMeta(backend: string, agent: string): SessionAcpMeta {
  return {
    backend,
    agent,
    runtimeSessionName: `session-${backend}`,
    mode: "persistent" as AcpRuntimeSessionMode,
    state: "idle",
    lastActivityAt: Date.now(),
  };
}
