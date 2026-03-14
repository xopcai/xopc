/**
 * ACP Runtime Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerAcpRuntimeBackend,
  unregisterAcpRuntimeBackend,
  getAcpRuntimeBackend,
  requireAcpRuntimeBackend,
  listAcpRuntimeBackends,
  hasAcpRuntimeBackend,
  __testing,
} from "../registry.js";
import type { AcpRuntime } from "./types.js";

describe("acp-runtime-registry", () => {
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

  describe("registerAcpRuntimeBackend", () => {
    beforeEach(() => {
      __testing.resetAcpRuntimeBackendsForTests();
    });

    it("should register a valid backend", () => {
      const backend = {
        id: "test-backend",
        runtime: createMockRuntime(),
      };

      registerAcpRuntimeBackend(backend);

      const result = getAcpRuntimeBackend("test-backend");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("test-backend");
    });

    it("should normalize backend id to lowercase", () => {
      const backend = {
        id: "Test-Backend",
        runtime: createMockRuntime(),
      };

      registerAcpRuntimeBackend(backend);

      const result = getAcpRuntimeBackend("TEST-BACKEND");
      expect(result?.id).toBe("test-backend");
    });

    it("should trim whitespace from backend id", () => {
      const backend = {
        id: "  test-backend  ",
        runtime: createMockRuntime(),
      };

      registerAcpRuntimeBackend(backend);

      const result = getAcpRuntimeBackend("test-backend");
      expect(result?.id).toBe("test-backend");
    });

    it("should throw when id is empty", () => {
      const backend = {
        id: "",
        runtime: createMockRuntime(),
      };

      expect(() => registerAcpRuntimeBackend(backend)).toThrow(
        "ACP runtime backend id is required",
      );
    });

    it("should throw when runtime is missing", () => {
      const backend = {
        id: "test-backend",
        runtime: undefined as unknown as AcpRuntime,
      };

      expect(() => registerAcpRuntimeBackend(backend)).toThrow(
        'ACP runtime backend "test-backend" is missing runtime implementation',
      );
    });

    it("should allow registering multiple backends", () => {
      registerAcpRuntimeBackend({
        id: "backend-1",
        runtime: createMockRuntime(),
      });
      registerAcpRuntimeBackend({
        id: "backend-2",
        runtime: createMockRuntime(),
      });

      const backends = listAcpRuntimeBackends();
      expect(backends).toHaveLength(2);
    });
  });

  describe("unregisterAcpRuntimeBackend", () => {
    beforeEach(() => {
      __testing.resetAcpRuntimeBackendsForTests();
    });

    it("should unregister existing backend", () => {
      registerAcpRuntimeBackend({
        id: "test-backend",
        runtime: createMockRuntime(),
      });

      unregisterAcpRuntimeBackend("test-backend");

      const result = getAcpRuntimeBackend("test-backend");
      expect(result).toBeNull();
    });

    it("should handle non-existent backend", () => {
      expect(() => unregisterAcpRuntimeBackend("non-existent")).not.toThrow();
    });

    it("should normalize id before unregistering", () => {
      registerAcpRuntimeBackend({
        id: "test-backend",
        runtime: createMockRuntime(),
      });

      unregisterAcpRuntimeBackend("TEST-BACKEND");

      const result = getAcpRuntimeBackend("test-backend");
      expect(result).toBeNull();
    });

    it("should handle empty id", () => {
      expect(() => unregisterAcpRuntimeBackend("")).not.toThrow();
    });
  });

  describe("getAcpRuntimeBackend", () => {
    beforeEach(() => {
      __testing.resetAcpRuntimeBackendsForTests();
    });

    it("should return backend by exact id", () => {
      registerAcpRuntimeBackend({
        id: "test-backend",
        runtime: createMockRuntime(),
      });

      const result = getAcpRuntimeBackend("test-backend");

      expect(result?.id).toBe("test-backend");
    });

    it("should return null for non-existent backend", () => {
      const result = getAcpRuntimeBackend("non-existent");

      expect(result).toBeNull();
    });

    it("should return first healthy backend when no id specified", () => {
      registerAcpRuntimeBackend({
        id: "backend-1",
        runtime: createMockRuntime(),
      });
      registerAcpRuntimeBackend({
        id: "backend-2",
        runtime: createMockRuntime(),
      });

      const result = getAcpRuntimeBackend();

      expect(result).not.toBeNull();
    });

    it("should skip unhealthy backends", () => {
      registerAcpRuntimeBackend({
        id: "unhealthy-backend",
        runtime: createMockRuntime(),
        healthy: () => false,
      });
      registerAcpRuntimeBackend({
        id: "healthy-backend",
        runtime: createMockRuntime(),
        healthy: () => true,
      });

      const result = getAcpRuntimeBackend();

      expect(result?.id).toBe("healthy-backend");
    });

    it("should return null when no backends registered", () => {
      const result = getAcpRuntimeBackend();

      expect(result).toBeNull();
    });
  });

  describe("requireAcpRuntimeBackend", () => {
    beforeEach(() => {
      __testing.resetAcpRuntimeBackendsForTests();
    });

    it("should return backend when registered", () => {
      registerAcpRuntimeBackend({
        id: "test-backend",
        runtime: createMockRuntime(),
      });

      const result = requireAcpRuntimeBackend("test-backend");

      expect(result.id).toBe("test-backend");
    });

    it("should throw when no backends registered", () => {
      expect(() => requireAcpRuntimeBackend()).toThrow(
        "ACP runtime backend is not configured. Install and enable an ACP runtime plugin.",
      );
    });

    it("should throw for non-existent backend when other backends exist", () => {
      registerAcpRuntimeBackend({
        id: "test-backend",
        runtime: createMockRuntime(),
      });

      // When other backends exist but the requested one doesn't,
      // it throws the general "not configured" error
      expect(() => requireAcpRuntimeBackend("non-existent")).toThrow(
        "ACP runtime backend is not configured",
      );
    });

    it("should throw when backend is unhealthy", () => {
      registerAcpRuntimeBackend({
        id: "unhealthy-backend",
        runtime: createMockRuntime(),
        healthy: () => false,
      });

      expect(() => requireAcpRuntimeBackend("unhealthy-backend")).toThrow(
        "ACP runtime backend is currently unavailable. Try again in a moment.",
      );
    });
  });

  describe("listAcpRuntimeBackends", () => {
    beforeEach(() => {
      __testing.resetAcpRuntimeBackendsForTests();
    });

    it("should return empty array when no backends", () => {
      const result = listAcpRuntimeBackends();

      expect(result).toEqual([]);
    });

    it("should return all registered backends", () => {
      registerAcpRuntimeBackend({
        id: "backend-1",
        runtime: createMockRuntime(),
      });
      registerAcpRuntimeBackend({
        id: "backend-2",
        runtime: createMockRuntime(),
      });

      const result = listAcpRuntimeBackends();

      expect(result).toHaveLength(2);
    });
  });

  describe("hasAcpRuntimeBackend", () => {
    beforeEach(() => {
      __testing.resetAcpRuntimeBackendsForTests();
    });

    it("should return false when no backends registered", () => {
      expect(hasAcpRuntimeBackend()).toBe(false);
    });

    it("should return true when backends are registered", () => {
      registerAcpRuntimeBackend({
        id: "test-backend",
        runtime: createMockRuntime(),
      });

      expect(hasAcpRuntimeBackend()).toBe(true);
    });
  });

  describe("__testing utilities", () => {
    it("should reset backends for tests", () => {
      registerAcpRuntimeBackend({
        id: "test-backend",
        runtime: createMockRuntime(),
      });

      __testing.resetAcpRuntimeBackendsForTests();

      expect(hasAcpRuntimeBackend()).toBe(false);
    });

    it("should expose global state", () => {
      const state = __testing.getAcpRuntimeRegistryGlobalStateForTests();

      expect(state).toBeDefined();
      expect(state.backendsById).toBeDefined();
      expect(state.backendsById).toBeInstanceOf(Map);
    });
  });
});
