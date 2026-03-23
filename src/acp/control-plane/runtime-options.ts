/**
 * Runtime Options
 * 
 * Utilities for managing ACP runtime options.
 */

import type { AcpSessionRuntimeOptions, SessionAcpMeta } from "../runtime/types.js";

/** Normalize optional string */
export function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Normalize runtime options object */
export function normalizeRuntimeOptions(options: Partial<AcpSessionRuntimeOptions> | undefined): AcpSessionRuntimeOptions {
  if (!options) return {};
  
  const result: AcpSessionRuntimeOptions = {};
  
  if (options.cwd) {
    result.cwd = options.cwd.trim();
  }
  
  if (options.runtimeMode) {
    result.runtimeMode = options.runtimeMode.trim();
  }
  
  for (const [key, value] of Object.entries(options)) {
    if (key !== "cwd" && key !== "runtimeMode") {
      result[key] = value;
    }
  }
  
  return result;
}

/** Merge runtime option patches */
export function mergeRuntimeOptions(params: {
  current: AcpSessionRuntimeOptions | undefined;
  patch: Partial<AcpSessionRuntimeOptions>;
}): AcpSessionRuntimeOptions {
  const { current = {}, patch } = params;
  return normalizeRuntimeOptions({
    ...current,
    ...patch,
  });
}

/** Shallow equality for runtime options */
export function runtimeOptionsEqual(
  a: AcpSessionRuntimeOptions | undefined,
  b: AcpSessionRuntimeOptions | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  
  if (keysA.length !== keysB.length) return false;
  
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    const key = keysA[i];
    if (a[key] !== b[key]) return false;
  }
  
  return true;
}

/** Options from session meta */
export function resolveRuntimeOptionsFromMeta(meta: SessionAcpMeta): AcpSessionRuntimeOptions {
  return meta.runtimeOptions ?? {};
}

/** Validate non-empty runtime mode string */
export function validateRuntimeModeInput(mode: string): string {
  const trimmed = mode.trim();
  if (!trimmed) {
    throw new Error("Runtime mode is required.");
  }
  return trimmed;
}

/** Validate config option key/value pair */
export function validateRuntimeConfigOptionInput(
  key: string,
  value: string,
): { key: string; value: string } {
  const normalizedKey = normalizeText(key);
  const normalizedValue = normalizeText(value);
  
  if (!normalizedKey) {
    throw new Error("Config option key is required.");
  }
  
  if (!normalizedValue) {
    throw new Error("Config option value is required.");
  }
  
  return { key: normalizedKey, value: normalizedValue };
}

/** Validate a partial runtime options patch */
export function validateRuntimeOptionPatch(
  patch: Partial<AcpSessionRuntimeOptions>,
): Partial<AcpSessionRuntimeOptions> {
  const result: Partial<AcpSessionRuntimeOptions> = {};
  
  if (patch.cwd !== undefined) {
    const cwd = normalizeText(patch.cwd);
    if (cwd) {
      result.cwd = cwd;
    }
  }
  
  if (patch.runtimeMode !== undefined) {
    const runtimeMode = normalizeText(patch.runtimeMode);
    if (runtimeMode) {
      result.runtimeMode = runtimeMode;
    }
  }
  
  return result;
}

/** Map a single config key/value to a runtime options patch */
export function inferRuntimeOptionPatchFromConfigOption(
  key: string,
  value: string,
): Partial<AcpSessionRuntimeOptions> {
  const result: Partial<AcpSessionRuntimeOptions> = {};
  
  switch (key) {
    case "cwd":
      result.cwd = value;
      break;
    case "mode":
    case "runtimeMode":
      result.runtimeMode = value;
      break;
    default:
      result[key] = value;
      break;
  }
  
  return result;
}