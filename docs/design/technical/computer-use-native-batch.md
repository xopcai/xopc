# Exact native input batches

Status: local development candidate based on Cua Driver `cua-driver-rs-v0.36.0`.
Real Calculator acceptance on 2026-10-30 initially took 11.5 seconds. The optimized
local candidate completed three visible-window runs in 701, 514 and 501 ms;
see both the original baseline and the subsequent optimization below.
Subsequent automatic preparation acceptance removed the manual placement
precondition: process-cold startup measured 1.64 seconds median and cross-Space
recovery 1.37 seconds, including private driver startup. See the final section.

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
- Initial implementation checks did not include desktop interaction.

## Initial Calculator baseline, 2026-10-30

The checksum-verified local arm64 candidate (`c40188986028a4665151ff03008c15ac2cb12f6d4e5a14544ba5596c22902dfa`)
completed three real Calculator runs. Each batch contained Escape to clear the
previous result, followed by eight semantic button activations for `123+345=`.
Each run submitted exactly one `run_steps` RPC, returned nine completed receipts,
and independently read `468` from the final native observation. A final screenshot
also showed `123+345` and `468`. There were six captures total (before and after
each run), with no invalid frames or recovery captures.

| Stage | Median of three runs |
| --- | ---: |
| Resolve already-running application/window | 1016.9 ms |
| Initial screenshot and accessibility observation | 91.5 ms |
| Native input batch | 10136.1 ms |
| Final screenshot and accessibility observation | 127.3 ms |
| Complete execution (median of per-run totals) | 11515.0 ms |

Per-run execution totals were 11662.1, 11327.5 and 11515.0 ms. The median
exceeds one second by 10515.0 ms. Component medians need not sum to the median
total. Driver initialization took 143.5 ms in the successful process. Explicit
application activation took another 1163.7 ms; initialization, activation and
the first measured flow together took 12969.3 ms, excluding harness file writes.

The first attempt stopped before input with `COMPUTER_WINDOW_OTHER_SPACE`.
The subsequent test explicitly activated the already-running Calculator through
the native driver. Consequently this measures activation and a visible running
application, **not a cold Calculator launch**. Its initial refusal remains evidence
of a product preparation limitation rather than a passing full launch test.

More than 99.9% of the batch time was inside its single SDK/native call; xopc's
identity check took approximately 2.4 ms, with zero render-grace delay. Application
enumeration accounted for approximately one second in each resolve stage. Native
semantic clicks in that initial candidate awaited cursor animation and window-change observation.
The latter has a 300 ms synchronous report window and up to one second of detached
focus protection by default. These are candidate optimization sites; the 10-second
batch had not yet been profiled into native substages. No protection timeout was
disabled for this test.

These measurements exclude model inference, Gateway transport, human approval
latency and screenshot upload. Three samples establish functional acceptance and
a latency baseline, not a p95 or a one-second product guarantee.

Reproduce explicitly with `pnpm exec tsx scripts/benchmark-computer-calculator-live.mts`.
For the separately recorded app activation setup, prefix
`XOPC_CALCULATOR_ACTIVATE=1`. The script controls the real Calculator and leaves
the final result displayed. New measurements and receipts are written under
`.cache/computer-calculator-live/`.

## Optimized candidate and native profiling, 2026-10-30

Final signed arm64 SHA-256:
`7ded6188f356465a9c7896363c3952ead2bffef967715b033e5d9481343218ef`.
The release driver pins remain unchanged. These are general exact-batch changes;
the production code contains no Calculator-specific branch, identifier or labels.

The native core now returns request-local, per-step timing in `timing`. Stages are
inclusive (for example, platform dispatch contains the background gate), so nested
metrics must not be added together. Profiling an earlier paced candidate with nine
semantic inputs measured 13.38 seconds: cursor arrival waits took 4885 ms, synchronous
window observation 2808 ms, exact-target proofs 75 ms and background gates 92 ms.
That profiling candidate did not individually instrument its remaining 5491 ms;
source inspection identified repeated process-family/plist queries and key-window
preparation, but that remainder is not claimed as an exact measurement of either.

The implemented changes are:

- Exact batches enqueue cursor feedback without waiting for animation arrival.
- Each post-action observation checks immediately, then continues late-window
  detection with the original protection deadline asynchronously. The 300 ms
  synchronous reporting wait is removed for exact batches; ordinary actions retain
  their existing behavior.
- Targeted focus suppression leases are retained through the batch instead of
  paying a 50 ms settle after each action. The final wildcard observer still covers
  late changes. A live key-window proof avoids redundant key-window priming; immutable
  process-family facts may be reused only inside the same exact batch.
- Running-app queries advertise `apps.running.v1`; xopc uses that live catalog for
  resolution and falls back to the installed catalog when the app is absent. Plists
  are parsed in-process with Core Foundation rather than repeatedly launching
  `plutil`. XML, binary, localized names and background-marker encodings are covered.
- Exact process/window/geometry checks, element ancestry, policy/session checks,
  deadlines, stop-on-failure and no-replay behavior remain in place. Pre-dispatch
  failures now always include their step index.

The final three runs independently returned `468`, each using one native RPC for
nine semantic inputs (observed All Clear, then `123+345=`) and two captures total.
Escape was replaced only in the acceptance script because it can leave a preceding
expression in place after an interrupted run. No intermediate screenshots or input
retries were used.

| Stage | Final median |
| --- | ---: |
| Resolve running application/window | 55.2 ms |
| Initial observation | 101.6 ms |
| Native batch | 262.0 ms |
| Final observation | 95.7 ms |
| Complete execution | 514.4 ms |

Per-run totals: **701.5 / 514.4 / 501.4 ms**. Driver initialization took 148.1 ms;
initialization plus the first run was **849.5 ms**. In the median run, cursor feedback
took 0.09 ms, window observation 15.6 ms, exact-target proofs 79.3 ms and background
gates 79.5 ms. The remaining target checks are intentionally live, not cached UI state.

Before final acceptance macOS repeatedly refused cross-Space preparation. Some
refused runs produced no input; an earlier profiling run stopped after a geometry
change. The final acceptance ran after the user manually made Calculator visible.
Thus the sub-second result certifies the **visible, already-running window** path,
including driver startup in the 849.5 ms case; it does not certify application cold
launch or cross-Space restoration. Models, Gateway transport, approval UI and frame
upload remain outside the timing scope. Three runs do not establish a p95 or SLA.

Validation: 989 core Rust tests and 601 macOS tests passed (7 ignored), 560 xopc
tests passed, and TypeScript checks passed. Windows/Linux native behavior was not
tested on devices; xopc's Windows path remains scalar and guarded.

## Automatic cold startup and cross-Space recovery, 2026-10-30

The macOS host now owns authorized application preparation. `prepare:true` uses
Electron's host activation and the system LaunchServices client with closed
`open -b <bundleId>` argv, followed by independent native process/window checks.
No shell interpreter, caller-supplied executable, app arguments, URL or launch
path is accepted. The host performs this only when starting/restoring is needed;
an already-visible target retains background delivery. Preparation remains behind
the session's existing access/approval boundary.

Background-daemon activation experiments could return an accepted request without
a usable current-Space window. They are not part of the final local implementation. The final
implementation requests activation from the visible Electron host; the native
driver continues to verify and dispatch all task inputs. Its signed local artifact
is still `7ded6188f356465a9c7896363c3952ead2bffef967715b033e5d9481343218ef`.
No new driver foreground API or experimental daemon-side launcher remains enabled.

The coordinator selects the exact window before restoring it, tolerates transient
Space changes during preparation, and keeps the common five-second deadline.
Readiness waits use conditional 16/32/64/128/250 ms backoff. After launch, zero-area
startup surfaces cannot become the input target. Two matching native bounds and
a valid target-bound full capture are still required; process/window replacement
and genuine multi-document ambiguity still stop preparation.

The full preparation observation can be consumed once by the immediately following
observe, within 250 ms and only after fresh process, visibility and geometry checks.
Expiry, geometry change, any input, a new resolve, and cleanup invalidate that reuse.
This removes a duplicate startup screenshot rather than treating activation as
proof of a ready application. Subsequent observations remain independent captures.

Final acceptance used the real Calculator through production `CuaComputerDriver`
in a visible temporary Electron host. Each cold fixture cooperatively quit the app,
verified that no running Calculator process remained, and stopped its fixture
driver. The measured flow then started a fresh private driver, launched the app,
observed it, submitted nine semantic inputs through one RPC, and independently
verified `468` after `123+345=`. Filesystem/system caches were not purged.

Each cross-Space fixture put only the disposable test host into a fullscreen Space
and independently verified that the original Calculator window was on another
Space. The measured flow automatically recovered the **same pid and window id**
and verified `468`. No user window placement or other user application activation
was used to establish these final fixtures. The temporary host/Space closes with
the harness.

| Scenario | Three totals, including driver startup | Median | Above 1 second |
| --- | --- | ---: | ---: |
| Process-cold app startup | 1639 / 2102 / 1585 ms | 1639 ms | 639 ms |
| Cross-Space recovery | 1369 / 1377 / 1358 ms | 1369 ms | 369 ms |

Stage breakdown of each scenario's median-total sample (rows sum to that total):

| Stage | Cold startup | Cross-Space recovery |
| --- | ---: | ---: |
| Private driver startup | 137.6 ms | 129.7 ms |
| System app preparation and exact-window readiness | 1043.5 ms | 860.1 ms |
| Initial observation using validated preparation frame | 10.5 ms | 6.9 ms |
| Native batch | 324.7 ms | 274.5 ms |
| Final observation | 122.9 ms | 98.2 ms |
| Total | 1639.2 ms | 1369.4 ms |

The system-open command itself took approximately 39–50 ms. The preparation total
also includes process registration, OS desktop/window animation, geometry stability
and the initial capture. One cold run required another readiness capture after an
invalid frame; no task input was replayed. All six initial observations reused the
validated preparation frame. The sub-second **visible-window** result above still
holds as its own measurement; cold startup and cross-Space recovery have not yet
met one second.

These totals start after a visible desktop host exists. They exclude fixture setup,
Electron application bootstrap, model inference, Gateway transport, human approval
latency and frame upload. Three samples per scenario are not p95/SLA evidence.
macOS preparation was tested; the existing Windows preparation path is retained.
The production artifact pins and published installer remain unchanged.

Reproduce one complete fixture and measurement:

```sh
XOPC_CALCULATOR_SCENARIO=cold XOPC_CALCULATOR_SAMPLES=1 pnpm exec tsx scripts/benchmark-computer-calculator-live.mts
XOPC_CALCULATOR_SCENARIO=cross-space XOPC_CALCULATOR_SAMPLES=1 pnpm exec tsx scripts/benchmark-computer-calculator-live.mts
```

Validation: 585 xopc tests and TypeScript checks passed. The rebuilt native artifact
has the same checksum as the previously certified 989 core / 601 macOS Rust tests.

## Preparation profiling and shorter readiness paths (2026-10-30)

Preparation now exposes exclusive stage totals, call counts and bounded readiness
samples through `getLastPreparationTiming()`. Samples contain elapsed time and a
reason code, without window titles or UI contents. System-open, host activation,
app catalog, process identity, native window metadata, AX-only probes, complete
capture and actual polling waits are accounted separately; `otherMs` is the
remaining coordinator time. These are fresh profiled runs, not retrospective
subdivisions of the earlier 1043.5/860.1 ms samples.

| Preparation component | Profiled cold run | Profiled cross-Space run |
| --- | ---: | ---: |
| Live app catalog | 34.8 ms / 2 calls | 19.3 ms / 1 call |
| Process identity | 30.9 ms / 10 calls | 33.7 ms / 10 calls |
| Window metadata | 271.8 ms / 9 calls | 67.6 ms / 7 calls |
| Complete AX + PNG capture | 212.6 ms / 1 call | 194.6 ms / 1 call |
| Conditional poll waits | 293.3 ms / 6 waits | 500.4 ms / 5 waits |
| Host activation + system-open + remainder | 38.6 ms | 53.1 ms |
| Preparation total | 882.0 ms | 868.7 ms |

The cold trace included an approximately 200 ms AX helper probe on a zero-area
startup surface. The cross-Space trace first saw usable geometry at about 404 ms,
then did not recheck until about 671 ms because of the 250 ms backoff. Changes:

- macOS `list_windows` optionally accepts `input_candidates:true`, advertised as
  `window.candidates.positive.v1`. Invalid/nonpositive geometry is filtered before
  helper AX probes. Hidden and off-Space positive windows remain candidates;
  this query never proves input eligibility or chooses a document. Older native
  drivers retain their original query through capability negotiation.
- Process/window publication polls every 32 ms and geometry readiness every
  16 ms. The first sample is immediate; these are conditional waits, not sleeps
  after every action. Two matching bounds and a full validated capture still gate
  readiness, under the same cancellation-aware five-second deadline.
- Embedded macOS hosts first use the driver's existing exact-window WindowServer
  capture route. Unavailable/empty results fall back to the existing public
  capture chain. Ownership, frame, scale and geometry checks remain in force.
- Read-only AX walks batch the current node's attributes through Apple's
  `AXUIElementCopyMultipleAttributeValues`. Unsupported bulk calls fall back to
  scalar getters. Individual CFNull/AXError values stay unavailable; false and
  numeric values preserve their types. This scope ends with that node's walk;
  actuators and their fresh eligibility/focus checks do not use its cached values.

Before AX batching was added, successful real-app checks measured 1197.5 ms for
process-cold startup (701.0 ms preparation) and 1090.7 ms for cross-Space recovery
(602.6 ms preparation). These are **single samples from different intermediate
artifacts**, not a final-version median or a sub-second acceptance claim. Both
verified `468` through one exact batch and a final independent observation.

Final AX-batched desktop acceptance completed after system unlock. All six runs
used signed local artifact
`34245dfb9e5ac3964e06d97b62550876391466caa43950b2c1dc159f38d5e38e`.
Each cold fixture verified process exit and a new pid; each cross-Space fixture
verified automatic recovery of the original pid/window id. Every run submitted
nine semantic inputs through one exact native RPC and independently verified
`468`; the two median-sample PNGs were also visually inspected. No manual window
placement or Space switch was required.

| Scenario | All three complete totals | Median | Difference from 1 second |
| --- | --- | ---: | ---: |
| Process-cold startup | 1616 / 1231 / 1227 ms | 1231 ms | 231 ms above |
| Cross-Space recovery | 1121 / 945 / 960 ms | 960 ms | 40 ms below |

Median-total samples have the following stage breakdown (rows sum to the total):

| Stage | Cold startup | Cross-Space recovery |
| --- | ---: | ---: |
| Private driver startup | 130.6 ms | 132.3 ms |
| Preparation and exact-window readiness | 772.7 ms | 520.3 ms |
| Initial observation reusing validated preparation capture | 8.3 ms | 7.9 ms |
| One native input batch | 260.1 ms | 234.3 ms |
| Independent final observation | 58.9 ms | 65.2 ms |
| Complete total | 1230.6 ms | 959.8 ms |

Preparation fell from the prior median samples' 1043.5/860.1 ms to
772.7/520.3 ms. This compares measured runs, rather than attributing every
millisecond to one change. In the final median cold sample, the window was first
published at 459.0 ms and geometry matched at 515.1 ms. The first capture was
invalid and discarded; a second capture established readiness at 770.3 ms. The
two captures cost 229.7 ms altogether. Conditional waits cost 348.2 ms, identity
checks 40.2 ms, metadata 75.2 ms, app catalog 37.9 ms and other overhead 41.5 ms.
No task input was replayed.

In the median cross-Space sample, current-Space geometry first appeared at
409.2 ms, matched at 435.0 ms and capture established readiness at 517.9 ms.
Capture cost 82.8 ms, conditional waits 205.5 ms, identity checks 48.9 ms,
metadata 111.3 ms, app catalog 20.4 ms and other overhead 51.2 ms. All six initial
observations reused their validated preparation captures once.

The first post-unlock run was slower, especially in native input dispatch; it is
included in the results. Three samples per scenario do not establish a p95 or a
one-second guarantee. Cross-Space recovery reached a sub-second median, while
process-cold startup still exceeded one second. The scope excludes Electron
bootstrap, fixture setup, model inference, Gateway/approval and upload.
System/filesystem caches were not purged. Locked-session fixture/semantic failures
are retained locally and excluded from the six successful measurements.

The cold fixture explicitly activates the exact app and cooperatively quits it
with a foreground shortcut outside the measured flow; production batches remain
exact background delivery. Production driver pins remain unchanged.

Validation: 590 xopc tests passed (9 skipped); TypeScript checks passed; native
core 990 and macOS 605 tests passed (1 and 6 ignored respectively). Attribute batch
coverage includes nested scope restoration, retained value ownership, false and
numeric state, incomplete responses, CFNull and per-attribute AXError results.

## Avoiding startup capture rejection (2026-10-30, subsequent pass)

Detailed `captureAttempts` telemetry now records each preparation capture's elapsed
start/end, native frame-valid flag, expected and captured geometry, dimensions,
image count and rejection reason. It contains no UI text or image bytes and is
bounded to 32 entries. A fresh old-native profiling run showed that the first
image was valid, but rejected as `bounds_changed`: the coordinator expected
230x408 points, whereas the native response attached 230x410 to a 460x816 PNG.
That capture cost 133.4 ms; another complete AX+PNG capture cost 67.5 ms. This
separates a geometry/readiness rejection from a missing or undecodable image.

The native backend now samples exact owner and geometry after capture, validates
the original pixels with the existing scale rules, and attaches that fresh frame.
Owner/window changes, absent geometry and incoherent pixels still fail. Snapshot
AX/pixel ordering remains sequential, including final observations after input.
The coordinator can retain a native-valid capture rejected only for changed
bounds: within 250 ms, fresh process/window/visibility checks and two matching
geometry samples can accept that same frame without another AX/pixel read. It
keeps the original capture timestamp; expiry or inconsistent geometry requires a
new capture. It never reuses an invalid native frame or follows a replacement
window. The earlier window-publication sample also counts toward stability.

A remaining intermediate run exposed a real animation plateau: two compositor
samples agreed on 230x406, yet the captured image was 460x820 with a 230x410 frame.
The window eventually settled at 230x408. To avoid doing a full capture on such
plateaus, macOS `list_windows` optionally accepts `include_layout_bounds:true`,
advertised as `window.layout_bounds.v1`. It reads only known visible exact
AXWindows' logical frames, with short AX messaging/deadline bounds and no tree
walk, activation, remote-token scan or retained cross-request objects. Missing
layout data means unknown and preserves the prior compositor-readiness path.
When available, layout and compositor geometry must agree before full capture;
the existing common deadline and cancellation still apply. Older native drivers
and Windows do not receive this optional query.

Healthy compact reads also skip computing the advisory `background_input` report
that response projection would discard. Verbose, full-output and degraded reads
retain it through the shared `ViewOptions` policy. Mutation eligibility checks
remain fresh. Repeated browser-family classification within one read is combined.

Final signed artifact:
`3a5c088a7889ffcc38a2f0d53c29f31f2ef4781f0103dc944f4aaabe8522a48b`.
The final six runs started after the automated checks, with no build/typecheck/
test intentionally running alongside them. This does not establish an otherwise
idle Mac. Every run used **one complete preparation capture, with no rejected
preparation frame**, one nine-action exact native RPC, and an independent final
observation verifying `468`. Median-sample PNGs were visually inspected. Cold
fixtures proved exit/new pid; cross-Space fixtures recovered the same pid/window.

| Scenario | All final complete totals | Median | Gap above 1 second |
| --- | --- | ---: | ---: |
| Process-cold startup | 1636 / 1533 / 1603 ms | 1603 ms | 603 ms |
| Cross-Space recovery | 1086 / 1115 / 1103 ms | 1103 ms | 103 ms |

Median-total samples:

| Stage | Cold startup | Cross-Space recovery |
| --- | ---: | ---: |
| Private driver startup | 138.6 ms | 130.2 ms |
| Preparation | 767.5 ms | 537.4 ms |
| Initial observation reusing preparation capture | 18.4 ms | 9.8 ms |
| Native input batch | 590.8 ms | 357.6 ms |
| Independent final observation | 87.7 ms | 68.4 ms |

The cold median preparation's 767.5 ms comprises 35.6 ms app catalog, 38.6 ms
process identity, 132.4 ms window/layout metadata, 163.7 ms AX+PNG capture,
349.1 ms conditional waits and 48.0 ms host/system-open/coordinator overhead.
The first window was published at 552.0 ms; geometry matched at 600.6 ms; capture
established readiness at 764.5 ms. Compared with the preceding 772.7 ms sample,
capture work fell from 229.7 ms/two captures to 163.7 ms/one, but metadata and
system response varied: this is not an overall 66 ms preparation speedup claim.

The whole-flow one-second goal was **not met** in this final group; the final
samples are slower than the preceding pass. A contemporaneous old-native control
(`34245df...`, with the new coordinator) also measured 1796.5 ms: 972.8 ms
preparation and 556.8 ms input. One control does not isolate environmental effects
from code changes or establish statistical performance superiority. Intermediate
runs, including 1099.6 ms without the layout gate, are retained in the evidence
and are not substituted for final-version acceptance. Qualification samples that
overlapped automated checks are labeled separately.

Scope remains private-driver startup through result observation, excluding
Electron bootstrap, fixture setup, LLM/Gateway/approval and upload. No caches were
purged; three runs per scenario do not establish p95 or an SLA. No application-
specific production logic was added, and published driver pins remain unchanged.

Validation: 597 xopc tests passed (9 skipped), TypeScript checks passed, and native
core 990 / macOS 607 tests passed (1 / 6 ignored). Coverage includes animation
plateaus, pending-frame reuse, expiry, cancellation, process/window replacement,
post-capture ownership/geometry and original scale rejection. Physical acceptance
is macOS only.

## Native query profiling and AB/BA acceptance (2026-10-30)

Request-local native telemetry now distinguishes blocking-pool submission-to-start
(`blocking_queue`) from closure wall time (`blocking_work`). Blocking jobs retain
their submission step even if the parent moves to another step. Raw AX wrappers
count/time property reads, bulk reads, action-name lookup, action dispatch,
attribute writes and window-id mapping. WindowServer enumeration, raw CG window
info, Space-query construction and per-window Space-membership queries have
separate counters/timers. Process inspection is also timed. These are wall/IPC
measurements, not CPU times. Parent and child stages remain inclusive and must
not be added together. Detached late-observation threads are outside this
request's recorded critical-path counters.

The first instrumented cold run took 540.4 ms in native input. Queue time was
0.46 ms across 45 blocking jobs, versus 328.4 ms inside those jobs. It made 45
window enumerations and 1350 per-window Space queries. Enumeration cost 290.7 ms
(including raw CG queries 180.7 ms and Space membership 101.9 ms). AX property
reads cost 132.2 ms across 270 calls; nine actual AX actions cost 57.1 ms. Thus a
blocking-pool redesign was not justified by this measurement.

General changes, without application-name branches:

- Window-change before/after samples use on-screen window ids/geometry without
  querying Space membership that the detector does not consume. Late-window
  detection and focus-suppression lifetimes remain intact.
- One background-policy acquisition gathers AX facts, then obtains one fresh
  post-AX WindowServer sample for owner/sibling checks. It reuses that sample
  within this acquisition only. When AX proves the target is the key window,
  the existing policy already has zero competing keyboard destinations; this
  path queries the exact owner rather than enumerating unused siblings.
- macOS `list_windows.window_id` performs an exact CGWindow metadata query,
  advertised as `window.metadata.exact.v1`. Invalid ids fail before enumeration.
  Strict batches and already-selected host targets use it only when supported;
  initial document selection and old-native/other-platform fallback are retained.
  Global/all-layer identity lookups also use the exact native query. No result
  may select a replacement window.
- Cursor center and rectangle derive from one live position/size read. Controls
  currently advertising AXPress skip the collection-selection ancestry preflight;
  unsupported controls keep it. Actual dispatch still reads live support and
  enabled state. A later support change cannot use an unprepared pixel fallback.
- macOS exact-input identity uses live kernel birth time with microseconds and
  executable path, bracketing the path lookup with birth-time reads. Missing,
  changed or incomplete evidence refuses. It removes nine native `ps` children
  without caching process identity; regular browser fingerprint behavior and
  other platform defaults are unchanged.
- Exact-batch cursor feedback now enqueues before acquiring any render-state
  lock. A qualification run exposed about 60 ms in that lock despite the earlier
  removal of animation-arrival waits. Scalar animation behavior is retained;
  batch feedback can place its first cursor immediately rather than seed a glide.

After checks completed, the same host coordinator ran twelve real-app cases:
three process-cold and three cross-Space cases per artifact, reversing AB/BA order
across pairs. File digests prove the coordinator stayed unchanged throughout.
Baseline is profiling-only native build
`5262049158f9534c1f1fc47618b8cc627ab5f9f55a487cf6d217762b2e3db856`;
optimized build is
`aab821a0006e19aa44ce874c35d1127c67eb8404217988c2b7666489d87ad8a4`.
Both include native receipt profiling. No test/build/typecheck intentionally
ran alongside acceptance; other host activity was uncontrolled. CPU/load samples
are retained and cover fixture plus flow plus teardown, not just the timed flow.

| Scenario | Baseline input median | Optimized input median | Baseline complete median | Optimized complete median |
| --- | ---: | ---: | ---: | ---: |
| Process-cold app | 531.9 ms | 308.5 ms | 1542.7 ms | 1293.7 ms |
| Cross-Space recovery | 349.5 ms | 135.4 ms | 1111.6 ms | 865.5 ms |

Each metric takes its own median; medians from separate columns are not stage
components that can be summed. All optimized cold complete totals were
1293.7/1317.2/1272.8 ms; all optimized cross-Space totals were
857.5/912.3/865.5 ms. Every paired optimized complete flow beat its baseline.
All twelve cases verified `468` using one nine-action exact input RPC, one
complete preparation capture and an independent final observation. Cross-Space
cases preserved pid/window; cold cases proved exit/new pid. Candidate median PNGs
were visually checked. No task input was replayed or manually placed foreground
window required.

Native detail for each artifact's cold **input-median** sample:

| Metric | Baseline | Optimized |
| --- | ---: | ---: |
| Blocking-pool queue | 0.45 ms | 0.59 ms |
| Blocking-job wall time, inclusive | 318.7 ms | 255.7 ms |
| WindowServer enumeration, inclusive | 295.0 ms / 45 | 87.7 ms / 36 |
| Raw CG window-info calls | 181.8 ms / 45 | 86.4 ms / 36 |
| Per-window Space membership | 105.2 ms / 1350 | 0.25 ms / 9 |
| AX property reads | 125.1 ms / 270 | 130.1 ms / 117 |
| AX window-id mapping | 3.9 ms / 54 | 5.3 ms / 36 |
| Actual AX action dispatch | 53.0 ms / 9 | 55.2 ms / 9 |
| Per-action process identity | 26.5 ms / 9 `ps` | 0.16 ms / 9 kernel checks |
| Exact process/window/geometry proof, inclusive | 140.4 ms | 3.8 ms |
| Background policy, inclusive | 167.9 ms | 83.5 ms |
| Cursor feedback submission | 0.015 ms | 0.002 ms |

The reduced AX call count did not reduce cold AX property time in this group;
remaining per-call response was slower. The optimized cross-Space input-median
sample used the same 117 property reads in 22.0 ms and 36 window enumerations in
43.3 ms. These establish state-dependent API wall/IPC latency, not its internal
OS/app cause. Queue saturation is not supported by the measurements. Avoiding
unused global Space work, repeated metadata work and subprocesses is directly
supported by counts and all paired comparisons; it does not explain every
historical fluctuation causally.

The optimized cold total-median sample still spent 137.5 ms starting its driver,
759.0 ms preparing the app/window, 9.9 ms in initial observation, 308.5 ms in
input and 78.8 ms in independent final observation. Its complete flow remains
293.7 ms over one second. Cross-Space reached under one second in all three
candidate runs, with median headroom 134.5 ms. This is not p95/SLA evidence or a
cross-application/cross-platform timing guarantee. The scope excludes Electron
bootstrap, fixture setup, LLM/Gateway/approval, upload and teardown; caches were
not purged. Production SDK/driver pins remain unchanged.

Reproduce the opt-in AB/BA comparison with the local signed artifacts:

```sh
pnpm exec tsx scripts/benchmark-computer-calculator-alternating.mts --baseline 5262049158f9534c1f1fc47618b8cc627ab5f9f55a487cf6d217762b2e3db856 --candidate aab821a0006e19aa44ce874c35d1127c67eb8404217988c2b7666489d87ad8a4 --pairs 3
```

Validation: 599 xopc tests passed (9 skipped), typecheck passed, and native core
991 / macOS 611 tests passed (1 / 6 ignored). New coverage includes queue/step
attribution, render-lock independence, invalid exact-window refusal and old-native
fallback, kernel identity loss/PID reuse/exec replacement and lazy selection
preflight. Existing ownership, modal/keyboard ambiguity, stale token, geometry
change, cancellation and popup-detection tests remain in the passing suites.
Desktop acceptance here is macOS only.

## Cold preparation and AX preflight acceptance (2026-10-30)

The next local artifact is `381e78702512512ebc24d12e240986c79a19274e185c77fb93e24ad7ee75eb09`.
Its same-session baseline is `aab821a0006e19aa44ce874c35d1127c67eb8404217988c2b7666489d87ad8a4`;
the historical 1294 ms result above is a different session, not this comparison's baseline.
No Calculator-specific production behavior was introduced.

Changes:

- Read-only AX geometry, app and control preflights use attribute packets. Each
  scope ends before mutation; enabled state, action support, ownership, process
  identity and late-window guards retain their dispatch checks. Batch scalar AX
  reads fell from 117 to 27, alongside 27 bulk packets, rather than removing the
  underlying proofs. Visual feedback alone reuses its before-action rectangle;
  it is never a pixel-input target or post-action correctness proof.
- Coordinator identity checks use a fresh bracketed kernel birth/executable
  sample through the existing `list_apps` tool's optional `process_identity_pid`
  argument and `process.identity.kernel.v1` capability. This avoids `ps` during
  readiness and batch dispatch. The candidate has one additional read RPC in
  the input stage and still exactly one mutation RPC. Missing native proof
  refuses; old native and other platform fallbacks remain. The rejected new-tool
  qualification approach was removed because SDK 0.36 rejects unknown names.
- App catalog PID discovery skips unused Space membership and parses each bundle
  plist once per snapshot. Exact window Space queries avoid whole-desktop scans.
  Embedded capture skips an unused pre-capture Space lookup, and response metadata
  reuses its existing fresh post-capture owner/frame sample. The final Space
  check and frame validation remain. Preparation made one valid capture per run.

Three AB/BA pairs per scenario, twelve physical macOS runs, all passed with nine
completed inputs, one mutation RPC and independent final verification of `468`.
Cold fixtures proved process exit/new PID; cross-Space fixtures preserved PID,
window and process identity without manual foreground placement. Both candidate
median screenshots were visually checked.

| Independent median | Baseline cold | Candidate cold | Baseline cross-Space | Candidate cross-Space |
| --- | ---: | ---: | ---: | ---: |
| Preparation | 827.3 ms | 764.6 ms | 543.4 ms | 510.3 ms |
| Initial observation | 10.7 ms | 4.2 ms | 10.1 ms | 3.8 ms |
| Input batch | 341.6 ms | 285.9 ms | 191.5 ms | 140.2 ms |
| Final observation | 84.3 ms | 64.8 ms | 71.0 ms | 47.0 ms |
| Complete, including driver startup | 1371.4 ms | 1258.1 ms | 965.7 ms | 838.2 ms |

These are independent medians and must not be summed. All paired candidate
complete flows improved. Candidate cold totals were 1257.6/1258.1/1301.8 ms;
cross-Space totals were 823.3/901.5/838.2 ms. Cold remains 258.1 ms over one second;
all three cross-Space runs finished below one second.

For an additive breakdown, the candidate **cold total-median sample** took
137.4 ms driver startup + 725.9 ms preparation + 4.2 ms initial observation +
312.9 ms input + 77.8 ms final observation = 1258.1 ms. Its preparation was
1.9 ms host focus, 32.5 ms system open, 26.3 ms app catalog (2 calls), 26.7 ms
identity (17), 120.0 ms metadata (16), 117.7 ms capture (1), 396.9 ms conditional
poll waits (13), and 3.9 ms other work. The first window appeared at 546.4 ms,
geometry stabilized at 606.6 ms and the validated capture was ready at 724.5 ms.
The waits are bounded readiness backoff, not a fixed delay after every action;
removing them blindly does not make the application publish a usable window sooner.

Native spans for that sample: blocking-pool queue 0.58 ms, blocking work
248.4 ms, 36 WindowServer enumerations 121.9 ms, nine Space membership queries
0.36 ms, 27 scalar AX reads 1.44 ms, 27 bulk AX reads 56.5 ms (app packets
53.5 ms), nine AX actions 52.6 ms, 18 AX compatibility writes 36.1 ms, 36 AX
window-id mappings 16.9 ms. Inclusive spans overlap and are not additive.
The cross-Space total-median sample used the same AX packet count in 3.09 ms,
with app packets 1.76 ms. This shows state-dependent IPC response time, without
establishing its internal OS/app cause. Pool queuing is not the bottleneck.

Remaining measured opportunities are request-scoped suppression of explicitly
unsupported AX compatibility writes (preserving transient-failure retries),
event-driven readiness replacing polling backoff, and keeping the driver ready
rather than paying its roughly 137 ms startup on each complete invocation.
These opportunities are not included in the measured gains or a one-second SLA.
The complete metric excludes fixture setup, Electron bootstrap, LLM, Gateway,
approval, upload and teardown. App processes were cold but filesystem caches were
not purged; three samples per arm do not establish p95 or cross-application timing.
Published SDK/driver pins are unchanged; acceptance uses the local signed driver.

Validation: 606 TypeScript tests passed (9 skipped), typecheck passed, native
core 991 / macOS 614 tests passed (1 / 6 ignored), and the local build succeeded.
Physical acceptance covers macOS; platform fallbacks retain their prior behavior.

## Notification readiness, compatibility retry backoff and resident reuse (2026-10-30)

Readiness notifications are optional wake hints, never evidence that a process,
window, geometry or input target is valid. The coordinator subscribes to workspace
launch/activation/Space events before preparing the application. macOS
`list_windows` advertises `window.readiness.notifications.v1` and accepts bounded
`readiness_wait_ms` waits, preserving the typed `windows: []` output envelope.
A process-incarnation-keyed observer is reused across waits, subscribes to window
creation/move/resize/deminiaturization, and coalesces early notifications. Observers
expire within five seconds, have a global limit of 64, and are explicitly ended
in preparation cleanup. Their run-loop resources are removed on their owner
thread. Old drivers and other platforms retain bounded polling.

A fresh process without a published window uses workspace launch hints and a
bounded metadata fallback before attempting AX subscriptions. This avoids forcing
an unavailable AX service to initialize repeatedly. If subscriptions are unavailable,
the coordinator does not retry them for an unchanged observed window set. It
retries when that set changes. Available subscriptions wake the existing fresh
validation sampler; missing notifications still reach a watchdog. Thus apps that
do not publish the relevant AX notifications still require metadata backoff;
this is not a promise to eliminate polling for every application or compositor.

Compatibility setup distinguishes explicitly unsupported attributes or an
unimplemented AX setter from transient rejection. Hard unsupported results are memoized only within the
current exact batch and process incarnation. Other failed opt-in attempts have a
100 ms request-local backoff, then may retry. This suppresses a probe without
sleeping or delaying an input; a new batch/observation is not held
behind that backoff. No enabled state, action support, focus, window owner,
geometry or mutation eligibility is cached by either optimization. Result-code
counts are profiled without attribute values or application content.

Normal broker release may retain a private transport for 30 seconds only if the
session was ready and no operation was in flight. Discovery can retain its
completed transport as well. Driver idle clears target, element, frame and
prepared-capture state; opening a later session still requires fresh broker
approval and a new target observation. Explicit stop, cancellation, hidden local
UI, pending preparation, errors and desktop disposal still stop the daemon.
Idle expiry stops it too. A racing input cannot take the resident release path.
Resident acceptance excludes the previous connection's already-paid startup
cost and is reported separately from first-use driver startup.

Final local artifact: `865710b4a0f7b5fc8612ac585f1c35bbf5a50305a57a2348b6db240a16660c75`;
same-session native baseline: `381e78702512512ebc24d12e240986c79a19274e185c77fb93e24ad7ee75eb09`.
Both use the same frozen coordinator, including its resident policy. This isolates
native changes from host lifecycle reuse; it does not compare an old coordinator
with a new one. Three AB/BA pairs × two scenarios × two lifecycle modes × two
artifacts produced 24 passing physical runs. Every run verified `468`, exactly
one nine-action mutation RPC, one read-only batch identity RPC and one valid
preparation capture. Cold fixtures proved exit/new PID; cross-Space fixtures
proved the same PID/window/process identity. Four candidate total-median PNGs
were visually checked. No user foreground assistance or task-input replay was used.

| Complete median, startup mode explicit | Baseline | Final candidate |
| --- | ---: | ---: |
| App process cold, fresh driver | 935.8 ms | 929.4 ms |
| App process cold, resident driver | 781.3 ms | 788.7 ms |
| Cross-Space recovery, fresh driver | 744.9 ms | 736.1 ms |
| Cross-Space recovery, resident driver | 571.1 ms | 568.0 ms |

Candidate cold/fresh totals: 929.4 / 923.0 / 932.6 ms. Candidate cold/resident:
797.6 / 782.7 / 788.7 ms. Candidate cross-Space/fresh: 744.7 / 730.2 / 736.1 ms;
cross-Space/resident: 556.9 / 568.0 / 672.3 ms. All final candidate complete samples
were below one second. The cold/fresh median has 70.6 ms headroom and its slowest
sample has 67.4 ms; neither establishes a p95 or a one-second guarantee.

Additive breakdown of the candidate **cold/fresh total-median sample**:
131.5 ms driver startup + 608.8 ms preparation + 3.1 ms initial observation +
140.9 ms input + 45.1 ms final observation = 929.4 ms. Preparation consisted of
1.7 ms host focus, 30.1 ms system open, 32.9 ms app catalog (2), 13.5 ms identity
(17), 76.2 ms metadata (16), 96.0 ms capture (1), 353.7 ms readiness waiting (13)
and 4.6 ms other work. The first window was published at 461.4 ms, geometry was
stable at 511.3 ms, and the validated frame was ready at 607.4 ms. The corresponding
resident total-median sample was 0.01 ms driver connection reuse + 599.2 ms
preparation + 3.3 ms initial observation + 134.9 ms input + 51.3 ms final
observation = 788.7 ms. These are whole-sample components, not sums of separate
stage medians.

Every candidate batch made two AX opt-in writes, versus 18 in every baseline
batch. Result counters identified one attribute-unsupported result and one
not-implemented result. The first batch-local hard rejection suppressed eight
redundant pairs. In the cold/fresh total-median samples, AX write spans were
36.1 ms baseline / 0.13 ms candidate; in cold/resident they were 20.3 / 17.2 ms.
This illustrates varying IPC cost even after reducing call counts. Pool queue
spans remained below one millisecond. Native profiling uses inclusive spans;
they cannot be added to stage wall times.

This particular application did not supply a usable AX notification wake in the
final samples. Cold publication used workspace hints and metadata watchdogs;
post-publication geometry and Space recovery predominantly used watchdog wakes.
The event-capable path and bounded fallback are implemented, but this experiment
does not demonstrate an event-driven preparation speedup. Preparation remains
roughly 600 ms for cold launch. The same-session baseline already reached
935.8 ms; comparing the historical 1258 ms with the new 929 ms would overstate
code gains. Native complete-flow changes are mixed: cold/resident regressed
7.4 ms in this small group. The clear architectural saving is avoiding the roughly
132 ms driver startup on an eligible resident request, while AX count reduction
is separately established. Three samples cannot establish statistical significance.

Two earlier 24-run comparisons are retained in the evidence, including a group
with 75–85% observed whole-host CPU busy fractions and slow cold samples above
one second. The first intermediate version had not recognized NotImplemented as
a hard rejection (18 writes); the next throttled it (4–6 writes). The final
version recognizes both unsupported categories (2 writes). Two initial
qualification failures rejected a missing typed output envelope before task
input; the envelope was fixed and covered by a contract test. A functional
qualification overlapping a build is explicitly excluded from performance claims.
No slow samples were removed from a comparison. All three comparisons and
qualifications are saved, rather than presenting only the quickest session.

The timed scope includes opening/restoring the application through independent
result observation and, in fresh mode, driver startup. It excludes fixture setup,
Electron bootstrap, model, Gateway, approval, upload and teardown. Process-cold
does not mean filesystem-cache-cold; caches were not purged, and repeated tests
can warm OS/application services. Physical acceptance covers macOS/arm64 only;
other platform fallbacks were not physically benchmarked here. Published pins
remain unchanged. Source/artifact hashes and CPU/load context are in the evidence.

Validation: 598 scoped TypeScript tests passed (9 skipped), typecheck passed,
native core 993 / macOS 617 passed (1 / 6 ignored), local signed build succeeded,
and both repositories passed `git diff --check`.

```sh
pnpm exec tsx scripts/benchmark-computer-calculator-alternating.mts --baseline 381e78702512512ebc24d12e240986c79a19274e185c77fb93e24ad7ee75eb09 --candidate 865710b4a0f7b5fc8612ac585f1c35bbf5a50305a57a2348b6db240a16660c75 --pairs 3 --lifecycle both
```

## Preparation round trips and observer shutdown follow-up (2026-10-30)

The historical resident 781→789 ms comparison did **not** show slower
preparation. Its complete-median samples had preparation 609.0→599.2 ms,
initial observation 2.77→3.29 ms, input 121.03→134.88 ms, and final observation
48.53→51.30 ms. The net increase was 7.4 ms. Native input app-attribute packet
spans increased 13.6→22.9 ms and AX window-id mapping 2.5→11.2 ms, while
compatibility writes fell 20.3→17.2 ms. These are inclusive spans, not additive
phase components. They establish slower responses in those samples, not an OS
internal cause or a proven notification regression. Three samples could not
establish a consistent resident penalty.

This follow-up removes separate readiness identity RPCs, not identity proof.
macOS `list_windows` optionally advertises `window.process_identity.v1` and accepts
`include_process_identity`. It samples fresh kernel incarnation/executable proof
before and after enumerating/filtering windows and reading AX layout. Missing or
changed proof refuses. The host compares the returned proof with its original
binding before exposing candidates. Readiness samples then omit the separate
`list_apps` identity RPC; initial binding, activation guards and final post-capture
checks remain. Old natives/other platforms retain their earlier checks.

Workspace notifications received before a fresh metadata read are acknowledged
by that read; a newer notification received during the read remains pending.
This avoids immediately repeating a query because of an already-covered launch
or activation hint. The event epoch/coalescing behavior has cancellation and
new-event coverage. Notifications still only wake fresh samplers.

Observer shutdown now signals its owner run loop with `CFRunLoopStop`, suppresses
new callback registration after stop, and waits for actual resource cleanup
with a 20 ms maximum acknowledgement budget. This is a completion notification,
not a fixed 20 ms sleep. The host bounds its cleanup RPC at 128 ms and records
whether the native worker confirmed completion; old native's missing confirmation
remains unknown. No input state is inferred from this diagnostic. This removes a
possible source of leftover AX work overlapping input; the experiment does not
prove that such overlap caused the historical 7.4 ms increase.

PID-scoped WindowServer parsing also skips other processes' name/title extraction.
New request-local metadata spans separate enumeration (including Space work),
AX helper reachability, logical layout and kernel proof. Host timing separately
records observer cleanup and covered workspace hints. No app-specific names,
labels or result shortcuts were added to production behavior.

Final signed local artifact:
`835e6ea783b17a7066b48f8e3d9afdb549eaad97583fe6504c9ee4a3cfd610de`;
native baseline: `865710b4a0f7b5fc8612ac585f1c35bbf5a50305a57a2348b6db240a16660c75`.
Five AB/BA pairs × fresh/resident driver × process-cold/cross-Space × baseline/
candidate produced **40 passing physical runs**. Both arms use one frozen new
coordinator; the comparison isolates native changes, while common hint coalescing
and cleanup instrumentation apply to both. Every run verified 468 using one
nine-action mutation RPC, one read-only input identity RPC, and one valid
preparation capture. Cold fixtures proved exit/new PID; cross-Space fixtures
preserved PID/window/process identity. Four candidate median PNGs were visually
checked. No input replay or user foreground assistance was required.

| Independent complete-flow median | Baseline | Candidate | Candidate observed range |
| --- | ---: | ---: | ---: |
| Cold app, fresh driver | 1292.1 ms | 1249.8 ms | 1198–1391 ms |
| Cold app, resident driver | 1130.4 ms | 1091.6 ms | 1047–1131 ms |
| Cross-Space, fresh driver | 833.3 ms | 842.0 ms | 819–876 ms |
| Cross-Space, resident driver | 714.7 ms | 733.7 ms | 721–876 ms |

The independent **preparation** median for resident cold launch was
793.0→761.1 ms, about 32 ms lower; fresh-cold preparation medians were
765.7→765.9 ms. These medians are not components of one sample and must not be
summed. Cold complete medians improved, while cross-Space complete medians
increased by 8.7/19.0 ms; there is no claim of consistent speedup for every
scenario. All ten candidate cold flows exceeded one second. All ten candidate
cross-Space flows were below it. Thus this session does **not** establish stable
one-second cold startup. The resident cold median still needs about 91.6 ms,
and its slowest observed candidate sample needs about 131 ms.

For additive detail, the candidate **resident cold total-median sample** took
0.01 ms connection reuse + 769.8 ms preparation + 2.8 ms initial observation +
249.5 ms input + 69.5 ms final observation = 1091.6 ms. Preparation was:

| Exclusive preparation stage | Time |
| --- | ---: |
| Host focus + system open | 39.4 ms |
| App catalog (2 calls) | 15.6 ms |
| Separate identity RPCs (2) | 2.1 ms |
| Window metadata (17 calls) | 130.1 ms |
| One valid AX/pixel capture | 171.1 ms |
| Conditional notification/watchdog waits (14) | 405.9 ms |
| Confirmed observer cleanup | 1.1 ms |
| Other host work | 4.4 ms |

Its metadata calls contained 51.5 ms enumeration/Space work, 25.9 ms AX
reachability, 22.9 ms AX layout and 0.43 ms kernel identity work. These are
subspans of metadata, not additional preparation stages. Remaining metadata
wall time includes transport, scheduling, serialization and uninstrumented filter
work; it must not all be called thread-pool queue time. The first usable window
was published at 528.8 ms, stable geometry observed at 596.1 ms and the validated
capture ready at 767.4 ms. Waiting intervals overlap the application's startup
progress; removing those intervals does not make its usable window exist earlier.
AX helper reachability is a first-publication safety filter; layout sampling
checks compositor/logical divergence and cannot simply be treated as duplicate
eligibility checks.

In every candidate cold run, separate readiness identity RPCs fell to 2, versus
roughly 17–18 baseline; cross-Space used 4 versus roughly 18, retaining activation
checks. Each metadata sample now contains two fresh native identity proofs.
Every candidate reported observer cleanup complete, with cleanup RPC wall time
0.49–1.41 ms. Workspace hints covered by fresh reads were recorded without
dropping newer events. Both natives retained two AX compatibility writes per
batch; this follow-up did not remove per-action proof or alter input delivery.

Compared with the earlier 929/789 ms session, both present-session arms are
slower. The same signed baseline now has 1292/1130 ms complete medians. Different
cohorts, OS/app/cache state and response timings mean historical numbers are not
an A/B control; CPU busy fraction alone cannot identify the cause. Candidate
resident-cold total-median-sample spans still include slow AX app-property and
WindowServer work; this is not explained by its sub-millisecond blocking queue.
The standalone qualification passed in 1337.5 ms and is retained separately; it
is not substituted for a comparison sample. No slow final samples were removed.

Scope: private driver startup (fresh mode), app launch/restore, input and
independent final observation. Excludes fixture setup, Electron bootstrap,
model/Gateway/approval/upload and teardown. App-process-cold does not mean
filesystem-cache-cold; caches were not purged. Five samples per arm do not
establish p95/SLA or cross-application/platform guarantees. Physical acceptance
is macOS/arm64; published pins are unchanged and other platform fallbacks were
not physically benchmarked. All source/artifact hashes and CPU/load context
are retained in the evidence.

Validation: 602 scoped TypeScript tests passed (9 skipped), typecheck passed,
native core 993 / macOS 619 passed (1 / 6 ignored), signed local build passed,
and both repositories passed `git diff --check`.

```sh
pnpm exec tsx scripts/benchmark-computer-calculator-alternating.mts --baseline 865710b4a0f7b5fc8612ac585f1c35bbf5a50305a57a2348b6db240a16660c75 --candidate 835e6ea783b17a7066b48f8e3d9afdb549eaad97583fe6504c9ee4a3cfd610de --pairs 5 --lifecycle both
```
