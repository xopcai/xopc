/**
 * Turn Manager
 * 
 * Manages ACP turn execution, cancellation, and latency tracking.
 */

import { AcpRuntimeError, toAcpRuntimeError, withAcpRuntimeErrorBoundary } from "../runtime/errors.js";
import type { AcpRuntimeEvent, AcpRuntimeHandle, SessionAcpMeta } from "../runtime/types.js";
import type { AcpRunTurnInput, ActiveTurnState, TurnLatencyStats } from "./manager.types.js";
import { normalizeActorKey, normalizeSessionKey } from "./manager.utils.js";

export class TurnManager {
  private readonly activeTurnBySession = new Map<string, ActiveTurnState>();
  private readonly turnLatencyStats: TurnLatencyStats = {
    completed: 0,
    failed: 0,
    totalMs: 0,
    maxMs: 0,
  };

  /** Get active turn for session */
  getActiveTurn(sessionKey: string): ActiveTurnState | undefined {
    return this.activeTurnBySession.get(normalizeActorKey(sessionKey));
  }

  /** Check if session has active turn */
  hasActiveTurn(sessionKey: string): boolean {
    return this.activeTurnBySession.has(normalizeActorKey(sessionKey));
  }

  /** Execute a turn */
  async executeTurn(params: {
    input: AcpRunTurnInput;
    runtime: {
      runtime: { runTurn: (input: Omit<AcpRunTurnInput, "cfg" | "sessionKey" | "onEvent">) => AsyncIterable<AcpRuntimeEvent>; cancel: (input: { handle: AcpRuntimeHandle; reason?: string }) => Promise<void> };
      handle: AcpRuntimeHandle;
      meta: SessionAcpMeta;
    };
    onStateChange: (state: SessionAcpMeta["state"], lastError?: string) => Promise<void>;
  }): Promise<void> {
    const { input, runtime: { runtime, handle, meta }, onStateChange } = params;
    const sessionKey = normalizeSessionKey(input.sessionKey);
    if (!sessionKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }

    const turnStartedAt = Date.now();
    const actorKey = normalizeActorKey(sessionKey);

    await onStateChange("running");

    const internalAbortController = new AbortController();
    const onCallerAbort = () => {
      internalAbortController.abort();
    };

    if (input.signal?.aborted) {
      internalAbortController.abort();
    } else if (input.signal) {
      input.signal.addEventListener("abort", onCallerAbort, { once: true });
    }

    const activeTurn: ActiveTurnState = {
      runtime,
      handle,
      abortController: internalAbortController,
    };
    this.activeTurnBySession.set(actorKey, activeTurn);

    let streamError: AcpRuntimeError | null = null;

    try {
      const combinedSignal =
        input.signal && typeof AbortSignal.any === "function"
          ? AbortSignal.any([input.signal, internalAbortController.signal])
          : internalAbortController.signal;

      for await (const event of runtime.runTurn({
        handle,
        text: input.text,
        attachments: input.attachments,
        mode: input.mode,
        requestId: input.requestId,
        signal: combinedSignal,
      })) {
        if (event.type === "error") {
          streamError = new AcpRuntimeError(
            this.normalizeErrorCode(event.code),
            event.message?.trim() || "ACP turn failed before completion.",
          );
        }
        if (input.onEvent) {
          await input.onEvent(event);
        }
      }

      if (streamError) {
        throw streamError;
      }

      this.recordCompletion({ startedAt: turnStartedAt });
      await onStateChange("idle");
    } catch (error) {
      const acpError = toAcpRuntimeError({
        error,
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "ACP turn failed before completion.",
      });

      this.recordCompletion({
        startedAt: turnStartedAt,
        errorCode: acpError.code,
      });

      await onStateChange("error", acpError.message);
      throw acpError;
    } finally {
      if (input.signal) {
        input.signal.removeEventListener("abort", onCallerAbort);
      }
      if (this.activeTurnBySession.get(actorKey) === activeTurn) {
        this.activeTurnBySession.delete(actorKey);
      }

      // Auto-close oneshot sessions
      if (meta.mode === "oneshot") {
        try {
          await runtime.close({ handle, reason: "oneshot-complete" });
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  /** Cancel active turn */
  async cancelTurn(params: {
    sessionKey: string;
    runtime: {
      runtime: { cancel: (input: { handle: AcpRuntimeHandle; reason?: string }) => Promise<void> };
      handle: AcpRuntimeHandle;
    };
    reason?: string;
  }): Promise<boolean> {
    const { sessionKey, runtime: { runtime, handle }, reason } = params;
    const actorKey = normalizeActorKey(sessionKey);
    const activeTurn = this.activeTurnBySession.get(actorKey);

    if (activeTurn) {
      activeTurn.abortController.abort();
      if (!activeTurn.cancelPromise) {
        activeTurn.cancelPromise = runtime.cancel({ handle: activeTurn.handle, reason });
      }
      await withAcpRuntimeErrorBoundary({
        run: async () => await activeTurn.cancelPromise!,
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "ACP cancel failed before completion.",
      });
      return true;
    }

    return false;
  }

  /** Get latency stats snapshot */
  getLatencyStats(): TurnLatencyStats {
    return { ...this.turnLatencyStats };
  }

  /** Get active turn count */
  getActiveTurnCount(): number {
    return this.activeTurnBySession.size;
  }

  private recordCompletion(params: {
    startedAt: number;
    errorCode?: AcpRuntimeError["code"];
  }): void {
    const durationMs = Math.max(0, Date.now() - params.startedAt);
    this.turnLatencyStats.totalMs += durationMs;
    this.turnLatencyStats.maxMs = Math.max(this.turnLatencyStats.maxMs, durationMs);

    if (params.errorCode) {
      this.turnLatencyStats.failed += 1;
    } else {
      this.turnLatencyStats.completed += 1;
    }
  }

  private normalizeErrorCode(code: string | undefined): AcpRuntimeError["code"] {
    const validCodes: AcpRuntimeError["code"][] = [
      "ACP_SESSION_INIT_FAILED",
      "ACP_TURN_FAILED",
      "ACP_BACKEND_MISSING",
      "ACP_BACKEND_UNAVAILABLE",
      "ACP_BACKEND_UNSUPPORTED_CONTROL",
    ];

    if (code && validCodes.includes(code as AcpRuntimeError["code"])) {
      return code as AcpRuntimeError["code"];
    }
    return "ACP_TURN_FAILED";
  }
}
