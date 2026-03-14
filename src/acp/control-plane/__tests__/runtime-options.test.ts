/**
 * ACP Runtime Options Tests
 */

import { describe, it, expect } from "vitest";
import {
  normalizeText,
  normalizeRuntimeOptions,
  mergeRuntimeOptions,
  runtimeOptionsEqual,
  resolveRuntimeOptionsFromMeta,
  validateRuntimeModeInput,
  validateRuntimeConfigOptionInput,
  validateRuntimeOptionPatch,
  inferRuntimeOptionPatchFromConfigOption,
} from "../runtime-options.js";
import type { AcpSessionRuntimeOptions, SessionAcpMeta } from "../../runtime/types.js";

describe("acp-runtime-options", () => {
  describe("normalizeText", () => {
    it("should return undefined for non-string values", () => {
      expect(normalizeText(null)).toBeUndefined();
      expect(normalizeText(undefined)).toBeUndefined();
      expect(normalizeText(123)).toBeUndefined();
      expect(normalizeText({})).toBeUndefined();
    });

    it("should return undefined for empty or whitespace-only strings", () => {
      expect(normalizeText("")).toBeUndefined();
      expect(normalizeText("   ")).toBeUndefined();
      expect(normalizeText("\t\n")).toBeUndefined();
    });

    it("should return trimmed string for valid input", () => {
      expect(normalizeText("  hello  ")).toBe("hello");
      expect(normalizeText("world")).toBe("world");
    });
  });

  describe("normalizeRuntimeOptions", () => {
    it("should return empty object for undefined", () => {
      expect(normalizeRuntimeOptions(undefined)).toEqual({});
    });

    it("should trim cwd and runtimeMode", () => {
      const result = normalizeRuntimeOptions({
        cwd: "  /path/to/dir  ",
        runtimeMode: "  persistent  ",
      });

      expect(result.cwd).toBe("/path/to/dir");
      expect(result.runtimeMode).toBe("persistent");
    });

    it("should preserve other options", () => {
      const result = normalizeRuntimeOptions({
        customOption: "value",
        anotherOption: 123,
      });

      expect(result.customOption).toBe("value");
      expect(result.anotherOption).toBe(123);
    });

    it("should handle whitespace-only cwd and runtimeMode differently", () => {
      const result = normalizeRuntimeOptions({
        cwd: "   ", // whitespace-only becomes "" after trim and is set
        runtimeMode: "", // empty string is falsy, so not set
        customOption: "value",
      });

      // cwd with whitespace becomes empty string (truthy check passes, trim makes it "")
      expect(result.cwd).toBe("");
      // runtimeMode with empty string is falsy, so not set at all
      expect(result.runtimeMode).toBeUndefined();
      expect(result.customOption).toBe("value");
    });
  });

  describe("mergeRuntimeOptions", () => {
    it("should merge patch into current options", () => {
      const result = mergeRuntimeOptions({
        current: { cwd: "/old/path", custom: "old" },
        patch: { cwd: "/new/path", newOption: "new" },
      });

      expect(result.cwd).toBe("/new/path");
      expect(result.custom).toBe("old");
      expect(result.newOption).toBe("new");
    });

    it("should handle undefined current", () => {
      const result = mergeRuntimeOptions({
        current: undefined,
        patch: { cwd: "/new/path" },
      });

      expect(result.cwd).toBe("/new/path");
    });

    it("should normalize merged options", () => {
      const result = mergeRuntimeOptions({
        current: { cwd: "  /old  " },
        patch: { runtimeMode: "  persistent  " },
      });

      expect(result.cwd).toBe("/old");
      expect(result.runtimeMode).toBe("persistent");
    });
  });

  describe("runtimeOptionsEqual", () => {
    it("should return true for same reference", () => {
      const options = { cwd: "/test" };
      expect(runtimeOptionsEqual(options, options)).toBe(true);
    });

    it("should return true for equal options", () => {
      expect(
        runtimeOptionsEqual(
          { cwd: "/test", custom: "value" },
          { cwd: "/test", custom: "value" },
        ),
      ).toBe(true);
    });

    it("should return true for both undefined", () => {
      expect(runtimeOptionsEqual(undefined, undefined)).toBe(true);
    });

    it("should return false for different values", () => {
      expect(
        runtimeOptionsEqual({ cwd: "/test1" }, { cwd: "/test2" }),
      ).toBe(false);
    });

    it("should return false for different number of keys", () => {
      expect(
        runtimeOptionsEqual({ cwd: "/test" }, { cwd: "/test", extra: "value" }),
      ).toBe(false);
    });

    it("should return false when one is undefined", () => {
      expect(runtimeOptionsEqual({ cwd: "/test" }, undefined)).toBe(false);
      expect(runtimeOptionsEqual(undefined, { cwd: "/test" })).toBe(false);
    });

    it("should handle empty objects", () => {
      expect(runtimeOptionsEqual({}, {})).toBe(true);
    });
  });

  describe("resolveRuntimeOptionsFromMeta", () => {
    it("should return runtimeOptions from meta", () => {
      const meta: SessionAcpMeta = {
        backend: "test",
        agent: "test-agent",
        runtimeSessionName: "test-session",
        mode: "persistent",
        state: "idle",
        lastActivityAt: Date.now(),
        runtimeOptions: { cwd: "/test", custom: "value" },
      };

      const result = resolveRuntimeOptionsFromMeta(meta);

      expect(result).toEqual({ cwd: "/test", custom: "value" });
    });

    it("should return empty object when runtimeOptions undefined", () => {
      const meta: SessionAcpMeta = {
        backend: "test",
        agent: "test-agent",
        runtimeSessionName: "test-session",
        mode: "persistent",
        state: "idle",
        lastActivityAt: Date.now(),
      };

      const result = resolveRuntimeOptionsFromMeta(meta);

      expect(result).toEqual({});
    });
  });

  describe("validateRuntimeModeInput", () => {
    it("should return trimmed mode", () => {
      expect(validateRuntimeModeInput("  persistent  ")).toBe("persistent");
    });

    it("should throw for empty input", () => {
      expect(() => validateRuntimeModeInput("")).toThrow("Runtime mode is required.");
      expect(() => validateRuntimeModeInput("   ")).toThrow("Runtime mode is required.");
    });
  });

  describe("validateRuntimeConfigOptionInput", () => {
    it("should return normalized key and value", () => {
      const result = validateRuntimeConfigOptionInput("  key  ", "  value  ");

      expect(result).toEqual({ key: "key", value: "value" });
    });

    it("should throw for missing key", () => {
      expect(() => validateRuntimeConfigOptionInput("", "value")).toThrow(
        "Config option key is required.",
      );
      expect(() => validateRuntimeConfigOptionInput("   ", "value")).toThrow(
        "Config option key is required.",
      );
    });

    it("should throw for missing value", () => {
      expect(() => validateRuntimeConfigOptionInput("key", "")).toThrow(
        "Config option value is required.",
      );
      expect(() => validateRuntimeConfigOptionInput("key", "   ")).toThrow(
        "Config option value is required.",
      );
    });
  });

  describe("validateRuntimeOptionPatch", () => {
    it("should validate and normalize cwd", () => {
      const result = validateRuntimeOptionPatch({ cwd: "  /new/path  " });

      expect(result.cwd).toBe("/new/path");
    });

    it("should validate and normalize runtimeMode", () => {
      const result = validateRuntimeOptionPatch({ runtimeMode: "  persistent  " });

      expect(result.runtimeMode).toBe("persistent");
    });

    it("should ignore empty values", () => {
      const result = validateRuntimeOptionPatch({
        cwd: "   ",
        runtimeMode: "",
      });

      expect(result.cwd).toBeUndefined();
      expect(result.runtimeMode).toBeUndefined();
    });

    it("should only validate cwd and runtimeMode, ignore other options", () => {
      const result = validateRuntimeOptionPatch({
        customOption: "value",
        anotherOption: 123,
      } as Partial<AcpSessionRuntimeOptions>);

      // validateRuntimeOptionPatch only validates cwd and runtimeMode
      // Other options are passed through but not explicitly handled
      // They should not be in result because the function only explicitly handles cwd/runtimeMode
      expect(result.customOption).toBeUndefined();
      expect(result.anotherOption).toBeUndefined();
    });

    it("should return empty object when patch is undefined", () => {
      // When patch is undefined, it should handle gracefully
      // But the function signature requires Partial<AcpSessionRuntimeOptions>
      // which can be undefined due to the type, so we test with undefined-like object
      const result = validateRuntimeOptionPatch({} as Partial<AcpSessionRuntimeOptions>);

      expect(result).toEqual({});
    });
  });

  describe("inferRuntimeOptionPatchFromConfigOption", () => {
    it("should infer cwd option", () => {
      const result = inferRuntimeOptionPatchFromConfigOption("cwd", "/path/to/dir");

      expect(result).toEqual({ cwd: "/path/to/dir" });
    });

    it("should infer runtimeMode from mode", () => {
      const result = inferRuntimeOptionPatchFromConfigOption("mode", "persistent");

      expect(result).toEqual({ runtimeMode: "persistent" });
    });

    it("should infer runtimeMode from runtimeMode", () => {
      const result = inferRuntimeOptionPatchFromConfigOption("runtimeMode", "oneshot");

      expect(result).toEqual({ runtimeMode: "oneshot" });
    });

    it("should store other keys as arbitrary options", () => {
      const result = inferRuntimeOptionPatchFromConfigOption("customKey", "customValue");

      expect(result).toEqual({ customKey: "customValue" });
    });
  });
});
