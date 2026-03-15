# ACP Implementation Comparison: xopcbot vs OpenClaw

## Overview

Both xopcbot and OpenClaw implement the **Agent Control Protocol (ACP)** - a runtime abstraction layer for managing agent sessions. This document compares their implementations.

| Aspect | xopcbot | OpenClaw |
|--------|---------|----------|
| **Source** | Forked/standalone | Original upstream |
| **Lines (ACP)** | ~1,319 (post-refactor) | ~2,323 |
| **Architecture** | Split managers | Monolithic + helpers |
| **Tests** | 225 tests | More comprehensive |
| **Last Sync** | Mar 14, 2026 | Latest |

---

## Core Type Definitions

### ✅ Nearly Identical

Both implementations share the same core type definitions:

```typescript
// AcpRuntime Interface - identical in both
interface AcpRuntime {
  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;
  runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent>;
  cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>;
  close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void>;
  getCapabilities?(): Promise<AcpRuntimeCapabilities>;
  getStatus?(): Promise<AcpRuntimeStatus>;
  setMode?(): Promise<void>;
  setConfigOption?(): Promise<void>;
  doctor?(): Promise<AcpRuntimeDoctorReport>;
}
```

### Key Types Comparison

| Type | xopcbot | OpenClaw | Difference |
|------|---------|----------|------------|
| `AcpRuntimeHandle` | Same | Same | ✅ Identical |
| `AcpRuntimeEvent` | Same | Same | ✅ Identical |
| `SessionIdentity` | Same | Same | ✅ Identical |
| `AcpRuntimeError` | Same codes | Same codes | ✅ Identical |

---

## Architecture Differences

### xopcbot (Refactored)

```
src/acp/control-plane/
├── manager.ts                 # 588 lines - Facade pattern
├── turn-manager.ts            # 209 lines - Turn execution
├── runtime-cache-manager.ts   # 235 lines - Handle caching
├── session-lifecycle-manager.ts # 287 lines - Session lifecycle
├── session-store.ts           # File persistence
├── session-actor-queue.ts     # Concurrency control
├── runtime-cache.ts           # Cache implementation
└── runtime-options.ts         # Options handling
```

**Design Philosophy:**
- Split into **specialized managers** by responsibility
- Each manager has a single, well-defined purpose
- Dependencies injected via constructor
- Easier to test in isolation

### OpenClaw (Upstream)

```
src/acp/control-plane/
├── manager.ts                 # 42 lines - Re-exports
├── manager.core.ts            # 1,290 lines - Main implementation
├── manager.identity-reconcile.ts # 159 lines - Identity reconciliation
├── manager.runtime-controls.ts   # 118 lines - Runtime controls
├── manager.types.ts           # 148 lines - Type definitions
├── manager.utils.ts           # 122 lines - Utilities
├── session-actor-queue.ts     # 38 lines
├── runtime-cache.ts           # 99 lines
└── runtime-options.ts         # 349 lines
```

**Design Philosophy:**
- Monolithic `manager.core.ts` with extracted helpers
- Identity reconciliation in separate module
- Runtime controls in separate module
- More feature-rich runtime-options handling

---

## Key Differences

### 1. Session Store Implementation

#### xopcbot
```typescript
// AcpSessionStore - standalone class
class AcpSessionStore {
  private indexCache: Map<string, SessionEntry>;
  async load(sessionKey: string): Promise<SessionEntry | null>;
  async save(sessionKey: string, entry: SessionEntry): Promise<void>;
}
```

#### OpenClaw
```typescript
// Multiple specialized functions
export async function readAcpSessionEntry(...)
export async function upsertAcpSessionMeta(...)
export async function listAcpSessionEntries(...)
```

**Difference:** xopcbot uses a class-based store, OpenClaw uses functional approach with more granular operations.

### 2. Session Identity Management

#### OpenClaw has more features:

```typescript
// OpenClaw: session-identifiers.ts - 4,364 bytes
export function normalizeSessionIdentifiers(...)
export function identifiersEqual(...)
export function resolveBackendSessionId(...)

// OpenClaw: session-identity.ts - 6,851 bytes  
export function createIdentityFromEnsure(...)
export function createIdentityFromStatus(...)
export function mergeSessionIdentity(...)
export function identityEquals(...)
export function isSessionIdentityPending(...)
```

#### xopcbot has simplified version:

```typescript
// xopcbot: session-identity.ts - similar but condensed
export function createIdentityFromEnsure(...)
export function mergeSessionIdentity(...)
```

### 3. Error Handling

Both use identical error codes:
- `ACP_SESSION_INIT_FAILED`
- `ACP_TURN_FAILED`
- `ACP_BACKEND_MISSING`
- `ACP_BACKEND_UNAVAILABLE`
- `ACP_BACKEND_UNSUPPORTED_CONTROL`

### 4. Configuration

#### xopcbot
```typescript
// In config/schema.ts
acp: {
  enabled?: boolean;
  backend?: string;
  defaultAgent?: string;
  maxConcurrentSessions?: number;
  dispatch?: { enabled?: boolean };
  stream?: { /* streaming options */ };
  runtime?: { ttlMinutes?: number };
}
```

#### OpenClaw
```typescript
// More detailed config structure
acp: {
  backend?: string;
  defaultAgent?: string;
  maxConcurrentSessions?: number;
  dispatch?: { enabled?: boolean };
  stream?: AcpStreamConfig;  // More detailed
  startup?: { reconcileIdentities?: boolean };
}
```

### 5. Runtime Registry

Both use **identical global Symbol-based registry**:

```typescript
// Same implementation in both!
const ACP_RUNTIME_REGISTRY_STATE_KEY = Symbol.for("...");
const ACP_BACKENDS_BY_ID = resolveAcpRuntimeRegistryGlobalState().backendsById;
```

Minor difference:
- xopcbot: `Symbol.for("xopcbot.acpRuntimeRegistryState")`
- OpenClaw: `Symbol.for("openclaw.acpRuntimeRegistryState")`

---

## Feature Comparison

| Feature | xopcbot | OpenClaw |
|---------|---------|----------|
| Session lifecycle | ✅ | ✅ |
| Turn execution | ✅ | ✅ |
| Runtime caching | ✅ | ✅ |
| TTL eviction | ✅ | ✅ |
| Identity reconciliation | ✅ | ✅ |
| Session modes (persistent/oneshot) | ✅ | ✅ |
| Runtime controls (setMode/setConfig) | ✅ | ✅ |
| Doctor/diagnostics | ✅ | ✅ |
| Concurrent session limit | ✅ | ✅ |
| Actor queue serialization | ✅ | ✅ |
| Config options validation | Basic | Advanced |
| Error text localization | ❌ | ✅ |
| Session rate limiting | ❌ | ✅ |
| MCP proxy support | ❌ | ✅ |

---

## Code Quality Comparison

### Test Coverage

| Metric | xopcbot | OpenClaw |
|--------|---------|----------|
| ACP Test Files | 11 | 20+ |
| Total ACP Tests | 225 | 300+ |
| Runtime Tests | ✅ | ✅ |
| Control Plane Tests | ✅ | ✅ |
| Manager Tests | ✅ (new) | ✅ (extensive) |

### Documentation

| Aspect | xopcbot | OpenClaw |
|--------|---------|----------|
| Architecture Doc | ✅ `docs/acp.md` | ❌ (inline) |
| Code Comments | Moderate | Extensive |
| Type Documentation | Good | Good |

---

## Recommendations for xopcbot

### 1. Consider Porting from OpenClaw

**High Priority:**
- `session-meta.ts` - More robust session metadata management
- `error-text.ts` - Localized error messages
- `runtime-internals/` - MCP proxy support

**Medium Priority:**
- Enhanced `runtime-options.ts` - More validation
- `translator.*` - Event translation utilities

### 2. Keep xopcbot Improvements

**Good in xopcbot:**
- Manager module split (more maintainable)
- Standalone `AcpSessionStore` class
- Comprehensive architecture documentation

### 3. Alignment Strategy

```typescript
// Option A: Stay compatible with upstream types
// Keep types identical for easy backend sharing

// Option B: Gradually port upstream features
// Start with session-meta improvements

// Option C: Maintain as simplified fork
// Focus on core features only
```

---

## Synchronization Checklist

To sync upstream improvements:

- [ ] Review `manager.core.ts` changes since fork
- [ ] Port `session-meta.ts` improvements
- [ ] Port `error-text.ts` for better error messages
- [ ] Review `runtime-options.ts` enhancements
- [ ] Sync test cases from upstream
- [ ] Update documentation

---

## Conclusion

**xopcbot ACP** is a well-refactored, simplified version of OpenClaw's ACP:

**Strengths:**
- Cleaner module separation
- Good test coverage
- Comprehensive documentation
- Simpler to understand

**Gaps:**
- Missing some advanced features (MCP proxy, rate limiting)
- Less granular session metadata operations
- No error message localization

**Recommendation:**
Keep xopcbot's clean architecture while selectively porting high-value features from OpenClaw upstream.
