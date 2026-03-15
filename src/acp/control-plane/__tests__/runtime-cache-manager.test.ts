/**
 * Runtime Cache Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeCacheManager } from "../runtime-cache-manager.js";
import { AcpRuntimeError } from "../../runtime/errors.js";
import type { AcpRuntime, AcpRuntimeHandle, SessionAcpMeta } from "../../runtime/types.js";
import type { Config } from "../../../config/schema.js";

// Mock the registry
vi.mock("../../runtime/registry.js", () => ({
  requireAcpRuntimeBackend: vi.fn(),
}));

import { requireAcpRuntimeBackend } from "../../runtime/registry.js";

describe("RuntimeCacheManager", () => {
  let cacheManager: RuntimeCacheManager;
  let mockPersistMeta: ReturnType<typeof vi.fn>;
  let mockEnforceLimit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockPersistMeta = vi.fn();
    mockEnforceLimit = vi.fn();
    cacheManager = new RuntimeCacheManager({
      persistMeta: mockPersistMeta,
      enforceConcurrentLimit: mockEnforceLimit,
    });
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

  describe("get/has/clear/size", () => {
    it("should return null for non-existent session", () => {
      expect(cacheManager.get("non-existent")).toBeNull();
    });

    it("should return false for has on non-existent session", () => {
      expect(cacheManager.has("non-existent")).toBe(false);
    });

    it("should return 0 for size when empty", () => {
      expect(cacheManager.size()).toBe(0);
    });

    it("should clear without error for non-existent session", () => {
      expect(() => cacheManager.clear("non-existent")).not.toThrow();
    });
  });

  describe("ensureHandle", () => {
    it("should create new handle when not cached", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      const cfg: Config = { acp: { backend: "test-backend" } } as Config;
      const meta = createMockMeta();

      const result = await cacheManager.ensureHandle({
        cfg,
        sessionKey: "test-session",
        meta,
      });

      expect(result.runtime).toBe(mockRuntime);
      expect(result.handle.backend).toBe("test-backend");
      expect(mockEnforceLimit).toHaveBeenCalled();
      expect(requireAcpRuntimeBackend).toHaveBeenCalledWith("test-backend");
    });

    it("should return cached handle when matches", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      const cfg: Config = { acp: { backend: "test-backend" } } as Config;
      const meta = createMockMeta();

      // First call
      await cacheManager.ensureHandle({ cfg, sessionKey: "test-session", meta });

      // Second call should use cache
      const result = await cacheManager.ensureHandle({ cfg, sessionKey: "test-session", meta });

      expect(mockRuntime.ensureSession).toHaveBeenCalledTimes(1); // Only called once
      expect(result.runtime).toBe(mockRuntime);
    });

    it("should invalidate cache when backend changes", async () => {
      const mockRuntime1 = createMockRuntime();
      const mockRuntime2 = createMockRuntime();
      const mockHandle1 = createMockHandle({ backend: "backend-1" });
      const mockHandle2 = createMockHandle({ backend: "backend-2" });

      vi.mocked(requireAcpRuntimeBackend)
        .mockReturnValueOnce({ id: "backend-1", runtime: mockRuntime1 })
        .mockReturnValueOnce({ id: "backend-2", runtime: mockRuntime2 });

      vi.mocked(mockRuntime1.ensureSession).mockResolvedValue(mockHandle1);
      vi.mocked(mockRuntime2.ensureSession).mockResolvedValue(mockHandle2);

      const cfg: Config = {} as Config;

      // First call with backend-1
      await cacheManager.ensureHandle({
        cfg,
        sessionKey: "test-session",
        meta: createMockMeta({ backend: "backend-1" }),
      });

      // Second call with backend-2 should create new handle
      await cacheManager.ensureHandle({
        cfg,
        sessionKey: "test-session",
        meta: createMockMeta({ backend: "backend-2" }),
      });

      expect(mockRuntime1.ensureSession).toHaveBeenCalledTimes(1);
      expect(mockRuntime2.ensureSession).toHaveBeenCalledTimes(1);
    });

    it("should throw for empty session key", async () => {
      await expect(
        cacheManager.ensureHandle({
          cfg: {} as Config,
          sessionKey: "   ",
          meta: createMockMeta(),
        }),
      ).rejects.toThrow("ACP session key is required");
    });

    it("should handle runtime ensureSession errors", async () => {
      const { requireAcpRuntimeBackend } = await import("../../runtime/registry.js");
      const mockRuntime = createMockRuntime();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockRejectedValue(new Error("Connection failed"));

      await expect(
        cacheManager.ensureHandle({
          cfg: {} as Config,
          sessionKey: "test-session",
          meta: createMockMeta(),
        }),
      ).rejects.toThrow(AcpRuntimeError);
    });

    it("should persist meta when identity changes", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle({
        backendSessionId: "new-session-id",
      });

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      const cfg: Config = {} as Config;
      const meta = createMockMeta();

      await cacheManager.ensureHandle({ cfg, sessionKey: "test-session", meta });

      expect(mockPersistMeta).toHaveBeenCalled();
    });

    it("should extract agent from session key if not in meta", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      const cfg: Config = { acp: { backend: "test-backend" } } as Config;
      const meta = createMockMeta({ agent: "" });

      await cacheManager.ensureHandle({
        cfg,
        sessionKey: "agent:myagent:acp:uuid",
        meta,
      });

      expect(mockRuntime.ensureSession).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "myagent" }),
      );
    });
  });

  describe("evictIdle", () => {
    it("should do nothing when cache is empty", async () => {
      const cfg: Config = { acp: { runtime: { ttlMinutes: 5 } } } as Config;

      await cacheManager.evictIdle({
        cfg,
        hasActiveTurn: () => false,
        onEvict: vi.fn(),
      });

      expect(cacheManager.size()).toBe(0);
    });

    it("should do nothing when TTL is 0", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      const cfg: Config = { acp: { runtime: { ttlMinutes: 0 } } } as Config;

      await cacheManager.ensureHandle({ cfg, sessionKey: "test-session", meta: createMockMeta() });

      await cacheManager.evictIdle({
        cfg,
        hasActiveTurn: () => false,
        onEvict: vi.fn(),
      });

      expect(cacheManager.size()).toBe(1);
    });

    it("should skip sessions with active turns", async () => {
      const mockRuntime = createMockRuntime();
      const mockHandle = createMockHandle();

      vi.mocked(requireAcpRuntimeBackend).mockReturnValue({
        id: "test-backend",
        runtime: mockRuntime,
      });

      vi.mocked(mockRuntime.ensureSession).mockResolvedValue(mockHandle);

      const cfg: Config = { acp: { runtime: { ttlMinutes: 0.001 } } } as Config; // 60ms TTL

      await cacheManager.ensureHandle({ cfg, sessionKey: "test-session", meta: createMockMeta() });

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      const onEvict = vi.fn();

      await cacheManager.evictIdle({
        cfg,
        hasActiveTurn: () => true, // Session has active turn
        onEvict,
      });

      expect(onEvict).not.toHaveBeenCalled();
      expect(cacheManager.size()).toBe(1);
    });
  });

  describe("getEvictionStats", () => {
    it("should return initial stats", () => {
      const stats = cacheManager.getEvictionStats();
      expect(stats.evictedTotal).toBe(0);
      expect(stats.lastEvictedAt).toBeUndefined();
    });
  });
});
