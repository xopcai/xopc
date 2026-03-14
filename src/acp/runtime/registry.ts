/**
 * ACP Runtime Registry
 * 
 * Global registry for ACP runtime backends.
 * Provides plugin-based runtime backend registration and discovery.
 */

import { AcpRuntimeError } from "./errors.js";
import type { AcpRuntime } from "./types.js";

/** ACP Runtime Backend */
export type AcpRuntimeBackend = {
  id: string;
  runtime: AcpRuntime;
  healthy?: () => boolean;
};

/** Registry 全局状态 */
type AcpRuntimeRegistryGlobalState = {
  backendsById: Map<string, AcpRuntimeBackend>;
};

const ACP_RUNTIME_REGISTRY_STATE_KEY = Symbol.for("xopcbot.acpRuntimeRegistryState");

function createAcpRuntimeRegistryGlobalState(): AcpRuntimeRegistryGlobalState {
  return {
    backendsById: new Map<string, AcpRuntimeBackend>(),
  };
}

function resolveAcpRuntimeRegistryGlobalState(): AcpRuntimeRegistryGlobalState {
  const runtimeGlobal = globalThis as typeof globalThis & {
    [ACP_RUNTIME_REGISTRY_STATE_KEY]?: AcpRuntimeRegistryGlobalState;
  };
  if (!runtimeGlobal[ACP_RUNTIME_REGISTRY_STATE_KEY]) {
    runtimeGlobal[ACP_RUNTIME_REGISTRY_STATE_KEY] = createAcpRuntimeRegistryGlobalState();
  }
  return runtimeGlobal[ACP_RUNTIME_REGISTRY_STATE_KEY];
}

const ACP_BACKENDS_BY_ID = resolveAcpRuntimeRegistryGlobalState().backendsById;

/** 标准化 Backend ID */
function normalizeBackendId(id: string | undefined): string {
  return id?.trim().toLowerCase() || "";
}

/** 检查 Backend 是否健康 */
function isBackendHealthy(backend: AcpRuntimeBackend): boolean {
  if (!backend.healthy) {
    return true;
  }
  try {
    return backend.healthy();
  } catch {
    return false;
  }
}

/** 注册 ACP Runtime Backend */
export function registerAcpRuntimeBackend(backend: AcpRuntimeBackend): void {
  const id = normalizeBackendId(backend.id);
  if (!id) {
    throw new Error("ACP runtime backend id is required");
  }
  if (!backend.runtime) {
    throw new Error(`ACP runtime backend "${id}" is missing runtime implementation`);
  }
  ACP_BACKENDS_BY_ID.set(id, {
    ...backend,
    id,
  });
}

/** 注销 ACP Runtime Backend */
export function unregisterAcpRuntimeBackend(id: string): void {
  const normalized = normalizeBackendId(id);
  if (!normalized) {
    return;
  }
  ACP_BACKENDS_BY_ID.delete(normalized);
}

/** 获取 ACP Runtime Backend */
export function getAcpRuntimeBackend(id?: string): AcpRuntimeBackend | null {
  const normalized = normalizeBackendId(id);
  if (normalized) {
    return ACP_BACKENDS_BY_ID.get(normalized) ?? null;
  }
  if (ACP_BACKENDS_BY_ID.size === 0) {
    return null;
  }
  // 返回第一个健康的 backend
  for (const backend of ACP_BACKENDS_BY_ID.values()) {
    if (isBackendHealthy(backend)) {
      return backend;
    }
  }
  return ACP_BACKENDS_BY_ID.values().next().value ?? null;
}

/** 获取必需的 ACP Runtime Backend */
export function requireAcpRuntimeBackend(id?: string): AcpRuntimeBackend {
  const normalized = normalizeBackendId(id);
  const backend = getAcpRuntimeBackend(normalized || undefined);
  if (!backend) {
    throw new AcpRuntimeError(
      "ACP_BACKEND_MISSING",
      "ACP runtime backend is not configured. Install and enable an ACP runtime plugin.",
    );
  }
  if (!isBackendHealthy(backend)) {
    throw new AcpRuntimeError(
      "ACP_BACKEND_UNAVAILABLE",
      "ACP runtime backend is currently unavailable. Try again in a moment.",
    );
  }
  if (normalized && backend.id !== normalized) {
    throw new AcpRuntimeError(
      "ACP_BACKEND_MISSING",
      `ACP runtime backend "${normalized}" is not registered.`,
    );
  }
  return backend;
}

/** 列出所有已注册的 Backend */
export function listAcpRuntimeBackends(): AcpRuntimeBackend[] {
  return Array.from(ACP_BACKENDS_BY_ID.values());
}

/** 检查是否有任何 Backend 注册 */
export function hasAcpRuntimeBackend(): boolean {
  return ACP_BACKENDS_BY_ID.size > 0;
}

/** 测试工具 */
export const __testing = {
  resetAcpRuntimeBackendsForTests(): void {
    ACP_BACKENDS_BY_ID.clear();
  },
  getAcpRuntimeRegistryGlobalStateForTests(): AcpRuntimeRegistryGlobalState {
    return resolveAcpRuntimeRegistryGlobalState();
  },
};