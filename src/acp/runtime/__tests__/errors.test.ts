/**
 * ACP Runtime Errors Tests
 */

import { describe, it, expect, vi } from "vitest";
import {
  AcpRuntimeError,
  normalizeAcpErrorCode,
  toAcpRuntimeError,
  withAcpRuntimeErrorBoundary,
  createUnsupportedControlError,
} from "../errors.js";
import type { AcpRuntimeErrorCode } from "../errors.js";

describe("acp-runtime-errors", () => {
  describe("AcpRuntimeError", () => {
    it("should create error with code and message", () => {
      const error = new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "Session initialization failed");

      expect(error.name).toBe("AcpRuntimeError");
      expect(error.code).toBe("ACP_SESSION_INIT_FAILED");
      expect(error.message).toBe("Session initialization failed");
    });

    it("should preserve error options", () => {
      const cause = new Error("Original error");
      const error = new AcpRuntimeError("ACP_TURN_FAILED", "Turn failed", { cause });

      expect(error.cause).toBe(cause);
    });
  });

  describe("normalizeAcpErrorCode", () => {
    it("should return valid codes as-is", () => {
      const codes: AcpRuntimeErrorCode[] = [
        "ACP_SESSION_INIT_FAILED",
        "ACP_TURN_FAILED",
        "ACP_BACKEND_MISSING",
        "ACP_BACKEND_UNAVAILABLE",
        "ACP_BACKEND_UNSUPPORTED_CONTROL",
      ];

      for (const code of codes) {
        expect(normalizeAcpErrorCode(code)).toBe(code);
      }
    });

    it("should return default code for invalid codes", () => {
      expect(normalizeAcpErrorCode(undefined)).toBe("ACP_TURN_FAILED");
      expect(normalizeAcpErrorCode("INVALID_CODE")).toBe("ACP_TURN_FAILED");
      expect(normalizeAcpErrorCode("")).toBe("ACP_TURN_FAILED");
    });

    it("should return default code for empty string", () => {
      expect(normalizeAcpErrorCode("")).toBe("ACP_TURN_FAILED");
    });
  });

  describe("toAcpRuntimeError", () => {
    it("should return existing AcpRuntimeError as-is", () => {
      const original = new AcpRuntimeError("ACP_BACKEND_MISSING", "Backend missing");
      const result = toAcpRuntimeError({
        error: original,
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "Should not be used",
      });

      expect(result).toBe(original);
    });

    it("should convert Error to AcpRuntimeError", () => {
      const original = new Error("Original error message");
      const result = toAcpRuntimeError({
        error: original,
        fallbackCode: "ACP_SESSION_INIT_FAILED",
        fallbackMessage: "Fallback message",
      });

      expect(result).toBeInstanceOf(AcpRuntimeError);
      expect(result.code).toBe("ACP_SESSION_INIT_FAILED");
      expect(result.message).toBe("Original error message");
      expect(result.cause).toBe(original);
    });

    it("should convert non-Error to AcpRuntimeError with fallback message", () => {
      const result = toAcpRuntimeError({
        error: "string error",
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "Fallback message",
      });

      expect(result).toBeInstanceOf(AcpRuntimeError);
      expect(result.code).toBe("ACP_TURN_FAILED");
      // Non-Error objects use fallback message
      expect(result.message).toBe("Fallback message");
    });

    it("should handle null and undefined", () => {
      const result1 = toAcpRuntimeError({
        error: null,
        fallbackCode: "ACP_BACKEND_UNAVAILABLE",
        fallbackMessage: "Backend unavailable",
      });

      expect(result1).toBeInstanceOf(AcpRuntimeError);
      expect(result1.code).toBe("ACP_BACKEND_UNAVAILABLE");
      expect(result1.message).toBe("Backend unavailable");

      const result2 = toAcpRuntimeError({
        error: undefined,
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "Turn failed",
      });

      expect(result2).toBeInstanceOf(AcpRuntimeError);
      expect(result2.message).toBe("Turn failed");
    });
  });

  describe("withAcpRuntimeErrorBoundary", () => {
    it("should return successful result", async () => {
      const result = await withAcpRuntimeErrorBoundary({
        run: async () => "success",
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "Should not be used",
      });

      expect(result).toBe("success");
    });

    it("should convert thrown error to AcpRuntimeError", async () => {
      await expect(
        withAcpRuntimeErrorBoundary({
          run: async () => {
            throw new Error("Original error");
          },
          fallbackCode: "ACP_SESSION_INIT_FAILED",
          fallbackMessage: "Session init failed",
        }),
      ).rejects.toThrow(AcpRuntimeError);
    });

    it("should preserve AcpRuntimeError", async () => {
      await expect(
        withAcpRuntimeErrorBoundary({
          run: async () => {
            throw new AcpRuntimeError("ACP_BACKEND_MISSING", "Backend missing");
          },
          fallbackCode: "ACP_TURN_FAILED",
          fallbackMessage: "Should not be used",
        }),
      ).rejects.toMatchObject({
        code: "ACP_BACKEND_MISSING",
        message: "Backend missing",
      });
    });

    it("should handle synchronous errors", async () => {
      const result = await withAcpRuntimeErrorBoundary({
        run: () => {
          throw new Error("Sync error");
        },
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "Turn failed",
      }).catch((e) => e);

      expect(result).toBeInstanceOf(AcpRuntimeError);
    });
  });

  describe("createUnsupportedControlError", () => {
    it("should create error with backend and control info", () => {
      const error = createUnsupportedControlError({
        backend: "test-backend",
        control: "session/set_mode",
      });

      expect(error).toBeInstanceOf(AcpRuntimeError);
      expect(error.code).toBe("ACP_BACKEND_UNSUPPORTED_CONTROL");
      expect(error.message).toBe(
        'ACP backend "test-backend" does not support control "session/set_mode".',
      );
    });
  });
});
