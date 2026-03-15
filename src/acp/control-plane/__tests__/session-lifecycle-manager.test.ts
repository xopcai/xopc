/**
 * Session Lifecycle Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionLifecycleManager } from "../session-lifecycle-manager.js";
import { AcpRuntimeError } from "../../runtime/errors.js";
import type { AcpRuntime, AcpRuntimeHandle, SessionAcpMeta } from "../../runtime/types.js";
import type { Config } from "../../../config/schema.js";
import type { AcpCloseSessionInput, SessionEntry } from "../manager.types.js";

// Mock the registry
vi.mock("../../runtime/registry.js", () => ({
  requireAcpRuntimeBackend: vi.fn(),
}));

import { requireAcpRuntimeBackend } from "../../runtime/registry.js";

describe("SessionLifecycleManager", () => {
  let lifecycleManager: SessionLifecycleManager;
  let mockLoadEntry: ReturnType<typeof vi.fn>;
  let mockSaveEntry: ReturnType<typeof vi.fn>;
  let mockListEntries: ReturnType<typeof vi.fn>;
  let mockEnforceLimit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLoadEntry = vi.fn();
    mockSaveEntry = vi.fn();
    mockListEntries = vi.fn();
    mockEnforceLimit = vi.fn();

    lifecycleManager = new SessionLifecycleManager({
      loadEntry: mockLoadEntry,
      saveEntry: mockSaveEntry,
      listEntries: mockListEntries,
      enforceConcurrentLimit: mockEnforceLimit,
    });

    vi.clearAllMocks();
  });

  const createMockRuntime = (): AcpRuntime => ({
    ensureSession: vi.fn(),
    runTurn: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
  });

  const createMockHandle = (overrides: Partial<AcpRuntimeHandle> = {}): AcpRuntimeHandle => ({
    sessionKey: "test-session",
    backend: "test-backend",
    runtimeSessionName: "test-runtime",
    ...overrides,
  });

  const createMockMeta = (overrides: Partial<SessionAcpMeta> = {}): SessionAcpMeta => ({
    backend: "test-backend",
    agent: "test-agent",
    runtimeSessionName: "test-runtime",
    mode: "persistent",
    state: "idle",
    lastActivityAt: Date.now(),
    ...overrides,
  });

  describe("resolveSession", () => {
    it("should return ready when cached", async () => {
      const meta = createMockMeta();
      const result = await lifecycleManager.resolveSession({
        sessionKey: "test-session",
        getCachedMeta: () => meta,
      });

      expect(result.kind).toBe("ready");
      expect(result.meta).toBe(meta);
    });

    it("should return ready from persistence", async () => {
      const meta = createMockMeta();
      mockLoadEntry.mockResolvedValue({ sessionKey: "test-session", acp: meta });

      const result = await lifecycleManager.resolveSession({
        sessionKey: "test-session",
        getCachedMeta: () => null,
      });

      expect(result.kind).toBe("ready");
      expect(mockLoadEntry).toHaveBeenCalledWith("test-session");
    });

    it("should return none for non-existent session", async () => {
      mockLoadEntry.mockResolvedValue(null);

      const result = await lifecycleManager.resolveSession({
        sessionKey: "test-session",
        getCachedMeta: () => null,
      });

      expect(result.kind).toBe("none");
    });

    it("should return stale for ACP session without metadata", async () => {
      mockLoadEntry.mockResolvedValue({ sessionKey: "agent:test:acp:uuid" });

      const result = await lifecycleManager.resolveSession({
        sessionKey: "agent:test:acp:uuid",
        getCachedMeta: () => null,
      });

      expect(result.kind).toBe("stale");
    });

    it("should return none for empty session key", async () => {
      const result = await lifecycleManager.resolveSession({
        sessionKey: "   ",
        getCachedMeta: () => null,
      });

      expect(result.kind).toBe("none");
    });
  });

  describe("initializeSession", () => {
    it("should create new session", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      const cfg: Config = { acp: { backend: "test-backend" } } as Config;

      const result = await lifecycleManager.initializeSession({
        input: {
          cfg,
          sessionKey: "test-session",
          agent: "test-agent",
          mode: "persistent",
        },
        onRuntimeCreated: vi.fn(),
      });

      expect(result.runtime).toBe(mockRuntime);
      expect(result.meta.backend).toBe("test-backend");
      expect(result.meta.agent).toBe("test-agent");
      expect(mockSaveEntry).toHaveBeenCalled();
      expect(mockEnforceLimit).toHaveBeenCalled();
    });

    it("should throw for empty session key", async () => {
      await expect(
        lifecycleManager.initializeSession({
          input: {
            cfg: {} as Config,
            sessionKey: "   ",
            agent: "test-agent",
            mode: "persistent",
          },
          onRuntimeCreated: vi.fn(),
        }),
      ).rejects.toThrow("ACP session key is required");
    });

    it("should use backend from config", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "config-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      const cfg: Config = { acp: { backend: "config-backend" } } as Config;

      await lifecycleManager.initializeSession({
        input: {
          cfg,
          sessionKey: "test-session",
          agent: "test-agent",
          mode: "persistent",
        },
        onRuntimeCreated: vi.fn(),
      });

      expect(requireAcpRuntimeBackend).toHaveBeenCalledWith("config-backend");
    });

    it("should handle runtime errors", async () => {
      const mockRuntime = createMockRuntime();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockRejectedValue(new Error("Failed"));

      await expect(
        lifecycleManager.initializeSession({
          input: {
            cfg: {} as Config,
            sessionKey: "test-session",
            agent: "test-agent",
            mode: "persistent",
          },
          onRuntimeCreated: vi.fn(),
        }),
      ).rejects.toThrow(AcpRuntimeError);
    });

    it("should trim agent name", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      await lifecycleManager.initializeSession({
        input: {
          cfg: {} as Config,
          sessionKey: "test-session",
          agent: "  test-agent  ",
          mode: "persistent",
        },
        onRuntimeCreated: vi.fn(),
      });

      expect(mockRuntime.ensureSession).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "test-agent" }),
      );
    });

    it("should support resume session", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      await lifecycleManager.initializeSession({
        input: {
          cfg: {} as Config,
          sessionKey: "test-session",
          agent: "test-agent",
          mode: "persistent",
          resumeSessionId: "prev-session-id",
        },
        onRuntimeCreated: vi.fn(),
      });

      expect(mockRuntime.ensureSession).toHaveBeenCalledWith(
        expect.objectContaining({ resumeSessionId: "prev-session-id" }),
      );
    });

    it("should use cwd from input", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      await lifecycleManager.initializeSession({
        input: {
          cfg: {} as Config,
          sessionKey: "test-session",
          agent: "test-agent",
          mode: "persistent",
          cwd: "/workspace/project",
        },
        onRuntimeCreated: vi.fn(),
      });

      expect(mockRuntime.ensureSession).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/workspace/project" }),
      );
    });
  });

  describe("closeSession", () => {
    it("should close session successfully", async () => {
      const mockRuntime = createMockRuntime();
      const meta = createMockMeta();

      mockRuntime.close.mockResolvedValue(undefined);

      const result = await lifecycleManager.closeSession({
        input: {
          cfg: {} as Config,
          sessionKey: "test-session",
          reason: "user-close",
        } as AcpCloseSessionInput,
        resolveSession: vi.fn().mockResolvedValue({
          kind: "ready",
          sessionKey: "test-session",
          meta,
        }),
        getRuntime: vi.fn().mockResolvedValue({ runtime: mockRuntime, handle: {} as AcpRuntimeHandle }),
        clearCached: vi.fn(),
      });

      expect(result.runtimeClosed).toBe(true);
      expect(mockRuntime.close).toHaveBeenCalledWith({
        handle: expect.any(Object),
        reason: "user-close",
      });
    });

    it("should clear meta when requested", async () => {
      const mockRuntime = createMockRuntime();
      const meta = createMockMeta();

      await lifecycleManager.closeSession({
        input: {
          cfg: {} as Config,
          sessionKey: "test-session",
          reason: "user-close",
          clearMeta: true,
        } as AcpCloseSessionInput,
        resolveSession: vi.fn().mockResolvedValue({
          kind: "ready",
          sessionKey: "test-session",
          meta,
        }),
        getRuntime: vi.fn().mockResolvedValue({ runtime: mockRuntime, handle: {} as AcpRuntimeHandle }),
        clearCached: vi.fn(),
      });

      expect(mockSaveEntry).toHaveBeenCalledWith("test-session", { sessionKey: "test-session" });
    });

    it("should return not closed when session not found", async () => {
      const result = await lifecycleManager.closeSession({
        input: {
          cfg: {} as Config,
          sessionKey: "test-session",
          reason: "user-close",
          requireAcpSession: false,
        } as AcpCloseSessionInput,
        resolveSession: vi.fn().mockResolvedValue({
          kind: "none",
          sessionKey: "test-session",
        }),
        getRuntime: vi.fn(),
        clearCached: vi.fn(),
      });

      expect(result.runtimeClosed).toBe(false);
      expect(result.metaCleared).toBe(false);
    });

    it("should throw when session required but not found", async () => {
      await expect(
        lifecycleManager.closeSession({
          input: {
            cfg: {} as Config,
            sessionKey: "test-session",
            reason: "user-close",
            requireAcpSession: true,
          } as AcpCloseSessionInput,
          resolveSession: vi.fn().mockResolvedValue({
            kind: "none",
            sessionKey: "test-session",
          }),
          getRuntime: vi.fn(),
          clearCached: vi.fn(),
        }),
      ).rejects.toThrow(AcpRuntimeError);
    });

    it("should allow force close when backend unavailable", async () => {
      const meta = createMockMeta();

      const result = await lifecycleManager.closeSession({
        input: {
          cfg: {} as Config,
          sessionKey: "test-session",
          reason: "user-close",
          allowBackendUnavailable: true,
        } as AcpCloseSessionInput,
        resolveSession: vi.fn().mockResolvedValue({
          kind: "ready",
          sessionKey: "test-session",
          meta,
        }),
        getRuntime: vi.fn().mockRejectedValue(
          new AcpRuntimeError("ACP_BACKEND_UNAVAILABLE", "Backend down"),
        ),
        clearCached: vi.fn(),
      });

      expect(result.runtimeClosed).toBe(false);
      expect(result.runtimeNotice).toContain("Backend down");
    });
  });

  describe("setSessionState", () => {
    it("should update session state", async () => {
      const meta = createMockMeta();
      mockLoadEntry.mockResolvedValue({ sessionKey: "test-session", acp: meta });

      await lifecycleManager.setSessionState({
        sessionKey: "test-session",
        state: "running",
        clearLastError: true,
      });

      expect(mockSaveEntry).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          sessionKey: "test-session",
          acp: expect.objectContaining({
            state: "running",
            lastActivityAt: expect.any(Number),
          }),
        }),
      );
    });

    it("should set last error", async () => {
      const meta = createMockMeta();
      mockLoadEntry.mockResolvedValue({ sessionKey: "test-session", acp: meta });

      await lifecycleManager.setSessionState({
        sessionKey: "test-session",
        state: "error",
        lastError: "Something went wrong",
      });

      expect(mockSaveEntry).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          acp: expect.objectContaining({
            state: "error",
            lastError: "Something went wrong",
          }),
        }),
      );
    });

    it("should do nothing when session not found", async () => {
      mockLoadEntry.mockResolvedValue(null);

      await lifecycleManager.setSessionState({
        sessionKey: "test-session",
        state: "running",
      });

      expect(mockSaveEntry).not.toHaveBeenCalled();
    });
  });

  describe("updateRuntimeOptions", () => {
    it("should update runtime options", async () => {
      const meta = createMockMeta({ runtimeOptions: { cwd: "/old" } });
      mockLoadEntry.mockResolvedValue({ sessionKey: "test-session", acp: meta });

      const clearCache = vi.fn();

      await lifecycleManager.updateRuntimeOptions({
        sessionKey: "test-session",
        options: { cwd: "/new", runtimeMode: "debug" },
        clearCacheIfCwdChanged: clearCache,
      });

      expect(mockSaveEntry).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          acp: expect.objectContaining({
            runtimeOptions: { cwd: "/new", runtimeMode: "debug" },
          }),
        }),
      );
      expect(clearCache).toHaveBeenCalledWith("test-session", "/new");
    });

    it("should clear cache when cwd changes", async () => {
      const meta = createMockMeta({ runtimeOptions: { cwd: "/old" } });
      mockLoadEntry.mockResolvedValue({ sessionKey: "test-session", acp: meta });

      const clearCache = vi.fn();

      await lifecycleManager.updateRuntimeOptions({
        sessionKey: "test-session",
        options: { cwd: "/new" },
        clearCacheIfCwdChanged: clearCache,
      });

      expect(clearCache).toHaveBeenCalledWith("test-session", "/new");
    });

    it("should do nothing when session not found", async () => {
      mockLoadEntry.mockResolvedValue(null);

      await lifecycleManager.updateRuntimeOptions({
        sessionKey: "test-session",
        options: { cwd: "/new" },
        clearCacheIfCwdChanged: vi.fn(),
      });

      expect(mockSaveEntry).not.toHaveBeenCalled();
    });
  });

  describe("listSessions", () => {
    it("should return only ACP sessions", async () => {
      const entries: SessionEntry[] = [
        { sessionKey: "session-1", acp: createMockMeta() },
        { sessionKey: "session-2", acp: createMockMeta() },
        { sessionKey: "session-3" }, // No ACP
      ];

      mockListEntries.mockResolvedValue(entries);

      const result = await lifecycleManager.listSessions();

      expect(result).toHaveLength(2);
      expect(result.map(e => e.sessionKey)).toEqual(["session-1", "session-2"]);
    });

    it("should return empty array when no ACP sessions", async () => {
      mockListEntries.mockResolvedValue([{ sessionKey: "session-1" }]);

      const result = await lifecycleManager.listSessions();

      expect(result).toEqual([]);
    });
  });
});
