/**
 * Turn Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TurnManager } from "../turn-manager.js";
import { AcpRuntimeError } from "../../runtime/errors.js";
import type { AcpRuntime, AcpRuntimeHandle, AcpRuntimeEvent, SessionAcpMeta } from "../../runtime/types.js";
import type { AcpRunTurnInput } from "../manager.types.js";

describe("TurnManager", () => {
  let turnManager: TurnManager;

  beforeEach(() => {
    turnManager = new TurnManager();
  });

  const createMockRuntime = (): AcpRuntime => ({
    ensureSession: vi.fn(),
    runTurn: vi.fn(async function* () {}),
    cancel: vi.fn(),
    close: vi.fn(),
  });

  const createMockHandle = (): AcpRuntimeHandle => ({
    sessionKey: "test-session",
    backend: "test-backend",
    runtimeSessionName: "test-runtime",
  });

  const createMockMeta = (mode: SessionAcpMeta["mode"] = "persistent"): SessionAcpMeta => ({
    backend: "test-backend",
    agent: "test-agent",
    runtimeSessionName: "test-runtime",
    mode,
    state: "idle",
    lastActivityAt: Date.now(),
  });

  describe("executeTurn", () => {
    it("should execute turn successfully", async () => {
      const runtime = createMockRuntime();
      const handle = createMockHandle();
      const meta = createMockMeta();
      const events: AcpRuntimeEvent[] = [];
      const stateChanges: Array<{ state: SessionAcpMeta["state"]; lastError?: string }> = [];

      vi.mocked(runtime.runTurn).mockImplementation(async function* () {
        yield { type: "text_delta", text: "Hello" };
        yield { type: "done" };
      });

      const input: AcpRunTurnInput = {
        cfg: {} as any,
        sessionKey: "test-session",
        text: "Hi",
        mode: "prompt",
        requestId: "req-123",
        async onEvent(event) {
          events.push(event);
        },
      };

      await turnManager.executeTurn({
        input,
        runtime: { runtime, handle, meta },
        onStateChange: async (state, lastError) => {
          stateChanges.push({ state, lastError });
        },
      });

      expect(stateChanges).toHaveLength(2);
      expect(stateChanges[0].state).toBe("running");
      expect(stateChanges[1].state).toBe("idle");
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("text_delta");
      expect(events[1].type).toBe("done");
    });

    it("should handle stream errors", async () => {
      const runtime = createMockRuntime();
      const handle = createMockHandle();
      const meta = createMockMeta();

      vi.mocked(runtime.runTurn).mockImplementation(async function* () {
        yield { type: "error", message: "Stream error", code: "ACP_TURN_FAILED" };
      });

      const input: AcpRunTurnInput = {
        cfg: {} as any,
        sessionKey: "test-session",
        text: "Hi",
        mode: "prompt",
        requestId: "req-123",
      };

      await expect(
        turnManager.executeTurn({
          input,
          runtime: { runtime, handle, meta },
          onStateChange: async () => {},
        }),
      ).rejects.toThrow(AcpRuntimeError);
    });

    it("should auto-close oneshot sessions", async () => {
      const runtime = createMockRuntime();
      const handle = createMockHandle();
      const meta = createMockMeta("oneshot");

      vi.mocked(runtime.runTurn).mockImplementation(async function* () {
        yield { type: "done" };
      });

      const input: AcpRunTurnInput = {
        cfg: {} as any,
        sessionKey: "test-session",
        text: "Hi",
        mode: "prompt",
        requestId: "req-123",
      };

      await turnManager.executeTurn({
        input,
        runtime: { runtime, handle, meta },
        onStateChange: async () => {},
      });

      expect(runtime.close).toHaveBeenCalledWith({
        handle,
        reason: "oneshot-complete",
      });
    });

    it("should handle abort signal", async () => {
      const runtime = createMockRuntime();
      const handle = createMockHandle();
      const meta = createMockMeta();
      const abortController = new AbortController();

      vi.mocked(runtime.runTurn).mockImplementation(async function* () {
        yield { type: "text_delta", text: "Hello" };
        abortController.abort();
        yield { type: "done" };
      });

      const input: AcpRunTurnInput = {
        cfg: {} as any,
        sessionKey: "test-session",
        text: "Hi",
        mode: "prompt",
        requestId: "req-123",
        signal: abortController.signal,
      };

      await turnManager.executeTurn({
        input,
        runtime: { runtime, handle, meta },
        onStateChange: async () => {},
      });

      // Should complete without error even after abort
    });

    it("should throw for empty session key", async () => {
      const runtime = createMockRuntime();
      const handle = createMockHandle();
      const meta = createMockMeta();

      const input: AcpRunTurnInput = {
        cfg: {} as any,
        sessionKey: "   ",
        text: "Hi",
        mode: "prompt",
        requestId: "req-123",
      };

      await expect(
        turnManager.executeTurn({
          input,
          runtime: { runtime, handle, meta },
          onStateChange: async () => {},
        }),
      ).rejects.toThrow("ACP session key is required");
    });

    it("should track latency stats", async () => {
      const runtime = createMockRuntime();
      const handle = createMockHandle();
      const meta = createMockMeta();

      vi.mocked(runtime.runTurn).mockImplementation(async function* () {
        yield { type: "done" };
      });

      const input: AcpRunTurnInput = {
        cfg: {} as any,
        sessionKey: "test-session",
        text: "Hi",
        mode: "prompt",
        requestId: "req-123",
      };

      await turnManager.executeTurn({
        input,
        runtime: { runtime, handle, meta },
        onStateChange: async () => {},
      });

      const stats = turnManager.getLatencyStats();
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.totalMs).toBeGreaterThanOrEqual(0);
    });

    it("should track failed turns in latency stats", async () => {
      const runtime = createMockRuntime();
      const handle = createMockHandle();
      const meta = createMockMeta();

      vi.mocked(runtime.runTurn).mockImplementation(async function* () {
        throw new Error("Runtime error");
      });

      const input: AcpRunTurnInput = {
        cfg: {} as any,
        sessionKey: "test-session",
        text: "Hi",
        mode: "prompt",
        requestId: "req-123",
      };

      await expect(
        turnManager.executeTurn({
          input,
          runtime: { runtime, handle, meta },
          onStateChange: async () => {},
        }),
      ).rejects.toThrow();

      const stats = turnManager.getLatencyStats();
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(1);
    });
  });

  describe("cancelTurn", () => {
    it("should cancel active turn", async () => {
      const runtime = createMockRuntime();
      const handle = createMockHandle();

      // Start a turn first
      vi.mocked(runtime.runTurn).mockImplementation(async function* () {
        await new Promise(resolve => setTimeout(resolve, 100));
        yield { type: "done" };
      });

      const input: AcpRunTurnInput = {
        cfg: {} as any,
        sessionKey: "test-session",
        text: "Hi",
        mode: "prompt",
        requestId: "req-123",
      };

      const meta = createMockMeta();

      // Start turn in background
      const turnPromise = turnManager.executeTurn({
        input,
        runtime: { runtime, handle, meta },
        onStateChange: async () => {},
      });

      // Small delay to ensure turn starts
      await new Promise(resolve => setTimeout(resolve, 10));

      // Cancel it
      const cancelled = await turnManager.cancelTurn({
        sessionKey: "test-session",
        runtime: { runtime, handle },
        reason: "user-cancel",
      });

      expect(cancelled).toBe(true);
      expect(runtime.cancel).toHaveBeenCalled();

      // Clean up
      try { await turnPromise; } catch {}
    });

    it("should return false when no active turn", async () => {
      const runtime = createMockRuntime();
      const handle = createMockHandle();

      const cancelled = await turnManager.cancelTurn({
        sessionKey: "test-session",
        runtime: { runtime, handle },
        reason: "user-cancel",
      });

      expect(cancelled).toBe(false);
    });
  });

  describe("getActiveTurnCount", () => {
    it("should return 0 when no active turns", () => {
      expect(turnManager.getActiveTurnCount()).toBe(0);
    });
  });

  describe("getLatencyStats", () => {
    it("should return initial stats", () => {
      const stats = turnManager.getLatencyStats();
      expect(stats).toEqual({
        completed: 0,
        failed: 0,
        totalMs: 0,
        maxMs: 0,
      });
    });
  });
});
