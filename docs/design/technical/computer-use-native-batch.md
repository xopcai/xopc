# Exact native input batches

Status: local development candidate based on Cua Driver `cua-driver-rs-v0.36.0`.
No desktop applications were opened or controlled during validation. Actual
latency and the one-second target remain unmeasured.

## Execution boundary

`ui.batch` retains its observation checkpoints. Adjacent primitive inputs form a
segment; on a capable driver, xopc sends that segment through one
`CuaDriver.callTool('run_steps', ...)` invocation. The native loop dispatches each
input through Cua's existing authorization and platform handlers. xopc still
performs the initial fresh state check and the final observation.

The published `0.36.0` driver already offers `run_steps`, but it can retry stale
element targets, route through menus, and read a recovery window after failure.
Those behaviors do not satisfy xopc's exact-window/no-replay boundary. The local
upstream patch adds `strict_targets` and advertises `input.batch.exact.v1`.
The generic SDK call already supports this additive tool contract, so the
existing SDK ABI is sufficient; published driver checksums are unchanged.

The strict request carries:

- `pid`, `window_id` and the previously captured native `expected_bounds`;
- `strict_targets:true`, `delivery_mode:'background'`,
  `foreground_fallback:false`, `delay_ms:0` and `timeout_ms:25000`;
- canonical `{tool,args}` steps, each repeating the same exact process/window;
- no selectors, aliases, nested batches, observation or recovery target.

The native loop proves process incarnation and native window visibility/geometry
before each input, checks its deadline again after the proof, and stops at the
first refusal or unconfirmed outcome. Semantic clicks require the accessibility
route. It never refinds an element, retries an input, switches delivery mode or
captures a different window. Existing per-step policy/session checks still run.
The result includes the completed prefix and the failed step's dispatch state.
Unreported suffix inputs are known unstarted only after a valid complete reply.

xopc validates contiguous indices, counts, failure location and state consistency.
A missing or malformed reply leaves every unproven input unknown; it cannot
trigger scalar replay. Cancellation reaps the private driver before returning,
because dropping an RPC alone does not prove the native loop stopped.

## Platform and compatibility limits

The common native contract and target probe wiring cover macOS, Windows and
Linux. xopc currently enables the fast path on macOS only. Its Windows path has
additional live UIA focus/writable-field checks that are not yet represented by
this native contract, so it keeps the existing scalar implementation. Linux is
outside xopc's desktop-input support. Explicit `wait` actions also retain the
existing implementation; `run_steps` does not provide that primitive.

Capability selection happens before input. Older drivers keep the existing
guarded scalar path. No fallback is allowed after a native batch was submitted.
This is ordered execution, not transactional rollback or a guarantee that
application rendering and network requests finish immediately.

## Build and use the local candidate

```sh
node scripts/build-computer-driver-local.mjs /path/to/cua
XOPC_COMPUTER_DRIVER_BUILD=local pnpm run electron:dev
```

The build requires matching SDK/driver baseline versions, builds release Rust,
ad-hoc signs the macOS candidate, and records its SHA-256, architecture, source
revision and dirty-source status in `.cache/computer-driver/local/current.json`.
The development host verifies that manifest and the binary bytes before loading.
Packaged builds ignore local selection and continue using the reviewed release
artifact. A production rollout still requires publishing/reviewing the native
change and updating the release artifact pins; this candidate is not shipped.

## Automated coverage

- Rust: strict preflight, mixed action ordering, no stale-token retry/recovery
  reads, per-input window geometry, pid reuse and deadline enforcement; existing
  batch, policy and runtime-isolation tests remain in the core regression suite.
- xopc: explicit capability negotiation, one native RPC, no intermediate capture,
  completed/unknown/unstarted receipts, malformed/lost responses, cancellation
  cleanup and local candidate integrity/platform checks.
- No real-app acceptance or timing benchmark was run.
