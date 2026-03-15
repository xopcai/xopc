/**
 * ACP Error Text Tests
 */

import { describe, it, expect } from "vitest";
import { AcpRuntimeError } from "../errors.js";
import { formatAcpErrorText, toAcpErrorText } from "../error-text.js";

describe("formatAcpErrorText", () => {
  it("should format error with next step for ACP_BACKEND_MISSING", () => {
    const error = new AcpRuntimeError(
      "ACP_BACKEND_MISSING",
      "Backend not found"
    );
    const text = formatAcpErrorText(error);

    expect(text).toContain("ACP error (ACP_BACKEND_MISSING):");
    expect(text).toContain("Backend not found");
    expect(text).toContain("💡");
    expect(text).toContain("acp doctor");
  });

  it("should format error with next step for ACP_BACKEND_UNAVAILABLE", () => {
    const error = new AcpRuntimeError(
      "ACP_BACKEND_UNAVAILABLE",
      "Backend is down"
    );
    const text = formatAcpErrorText(error);

    expect(text).toContain("ACP error (ACP_BACKEND_UNAVAILABLE):");
    expect(text).toContain("Backend is down");
    expect(text).toContain("💡");
  });

  it("should format error with next step for ACP_SESSION_INIT_FAILED", () => {
    const error = new AcpRuntimeError(
      "ACP_SESSION_INIT_FAILED",
      "Failed to create session"
    );
    const text = formatAcpErrorText(error);

    expect(text).toContain("ACP error (ACP_SESSION_INIT_FAILED):");
    expect(text).toContain("Failed to create session");
    expect(text).toContain("💡");
    expect(text).toContain("stale");
  });

  it("should format error with next step for ACP_BACKEND_UNSUPPORTED_CONTROL", () => {
    const error = new AcpRuntimeError(
      "ACP_BACKEND_UNSUPPORTED_CONTROL",
      "Control not supported"
    );
    const text = formatAcpErrorText(error);

    expect(text).toContain("ACP error (ACP_BACKEND_UNSUPPORTED_CONTROL):");
    expect(text).toContain("Control not supported");
    expect(text).toContain("💡");
  });

  it("should format error with next step for ACP_TURN_FAILED", () => {
    const error = new AcpRuntimeError("ACP_TURN_FAILED", "Turn failed");
    const text = formatAcpErrorText(error);

    expect(text).toContain("ACP error (ACP_TURN_FAILED):");
    expect(text).toContain("Turn failed");
    expect(text).toContain("💡");
    expect(text).toContain("Retry");
  });

  it("should format error without next step for unknown error", () => {
    const error = new AcpRuntimeError(
      "ACP_INVALID_RUNTIME_OPTION",
      "Invalid option"
    );
    const text = formatAcpErrorText(error);

    expect(text).toBe("ACP error (ACP_INVALID_RUNTIME_OPTION): Invalid option");
    expect(text).not.toContain("💡");
  });
});

describe("toAcpErrorText", () => {
  it("should convert unknown error to formatted text", () => {
    const text = toAcpErrorText({
      error: new Error("Something went wrong"),
      fallbackCode: "ACP_TURN_FAILED",
      fallbackMessage: "Unknown error",
    });

    expect(text).toContain("ACP_TURN_FAILED");
    expect(text).toContain("Something went wrong");
  });

  it("should use fallback for non-error values", () => {
    const text = toAcpErrorText({
      error: "string error",
      fallbackCode: "ACP_SESSION_INIT_FAILED",
      fallbackMessage: "Session init failed",
    });

    expect(text).toContain("ACP_SESSION_INIT_FAILED");
    expect(text).toContain("Session init failed");
  });

  it("should preserve AcpRuntimeError code", () => {
    const originalError = new AcpRuntimeError(
      "ACP_BACKEND_MISSING",
      "Backend not configured"
    );

    const text = toAcpErrorText({
      error: originalError,
      fallbackCode: "ACP_TURN_FAILED",
      fallbackMessage: "Fallback message",
    });

    expect(text).toContain("ACP_BACKEND_MISSING");
    expect(text).toContain("Backend not configured");
  });
});
