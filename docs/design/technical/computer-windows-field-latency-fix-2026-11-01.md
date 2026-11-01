# Windows field verification and input latency fixes

The final suite 1.1.0 run completed all 48 planned native cases: WinForms 24/24
and WPF 24/24. All six exact-field probes were satisfied; an intentionally wrong
value was rejected in every replacement case. No duplicate native input, scope
violation, post-stop input, focus refusal or unknown dispatch was recorded. The
final source fingerprints matched at completion.

The [retained evidence](evidence/computer-windows-field-latency-fix-2026-11-01.json)
contains the fixed manifest, existing evaluation records, per-action timing and
keyboard focus measurements. Full app-owned oracle snapshots remain in ignored
run `06739ebb-ab58-4d12-b6e4-ce8f42bb6d55`.

## Field verification

Windows accessibility summaries remain explicitly partial. Instead of inferring
uniqueness from a clipped tree, the independent native input census now supplies
field names alongside the existing identity, password, enabled, readonly and
offscreen metadata. This census is freshly read on every observation and input
guard. Its size limit still fails closed.

An allowed field receives `fieldLabelUnique` only when the complete native input
census proves that its label identifies one editor. Qt's outer/inner pair is
accepted only when both trees establish the same parent/child relationship, exact
shared geometry and safe metadata. Two same-name fields at different locations,
including an unsafe duplicate, cannot receive the certificate.

`verifyComputerExpectation` can therefore compare the exact value of one certified
Windows field despite the partial public summary. Missing certification, duplicate
labels, protected/disabled fields and web content remain unavailable. An incorrect
expected value returns `not_met`. Selected-state verification on a partial tree
remains unchanged; this patch does not claim complete tree coverage.

Suite 1.1.0 makes field verification part of replacement acceptance. The original
suite 1.0.0 only recorded this unsupported capability as a probe, so its old 16/16
smoke must not be presented as passing the stronger field contract.

## Latency

The previous identity helper started PowerShell and compiled C# on every read.
An observation performs both pre-capture identity validation and a fresh
post-capture input read; Broker freshness/stability checks repeat observations.
The repeated process and compiler startup dominated actual input dispatch time.

Each desktop driver now owns a private, serialized, read-only PowerShell worker.
It compiles its fixed native helper code once, then reads new OS identity, window
ownership, application IDs and input metadata for every JSON request. No target
state, focus or permissions are cached. The worker has an eight-second request
deadline, bounded output, cancellation, idle expiry and driver-owned cleanup.
Disposal rejects queued reads. Malformed output or a hung provider discards the
worker instead of accepting a partial result. The helper protocol cannot execute
arbitrary commands or deliver input.

| Broker action timing | Previous smoke, 18 actions | Final run, 54 actions |
| --- | ---: | ---: |
| Median | 5,031 ms | 668 ms |
| Observed 95th percentile | 5,286 ms | 951 ms |

The observed median reduction is 86.7%. This is a descriptive same-machine
comparison, not a matched release experiment: the old smoke had one repetition,
the new run has three and a stricter field assertion. It measures native Broker
actions, not LLM latency. Native subphase receipts remain available for profiling.
No target, freshness, permission, focus or pre-dispatch check was removed to obtain
these times. The daemon continues using background input without a foreground
fallback.

## Focus and background clicks

All six keyboard cases clicked the real fixture editor and delivered End followed
by Backspace. The app's actual key event and final `ab` value were independently
checked. All twelve key receipts had a certified editable target focused before
dispatch. All six duplicate-envelope button cases produced exactly one app-owned
click increment each.

The earlier focus refusal and unknown WPF click were not reproduced in this final
matrix. Reusing compiled read-only helpers substantially shortens the interval
between observations and fresh native checks; attributing every historical focus
failure to that interval would still be an inference. The test does not force all
possible foreground/occlusion transitions, and these two native frameworks do not
establish background support for every third-party app. Unknown delivery still
stops subsequent input and is never automatically replayed.

## Verification and retained attempts

- Final native matrix: `06739ebb-ab58-4d12-b6e4-ce8f42bb6d55`, 48/48, six successful
  field probes, zero observed incidents and no source drift; zero model calls.
- Final deterministic regression export: `867e3267-30fa-43ed-8b17-6e4dd1c9d49a`,
  662 tests passed across 44 files.
- `pnpm run typecheck:electron` and `pnpm run computer:benchmark:check` passed.
- Worker tests exercise fresh serialized replies, fragmentation, malformed and
  oversized output, cancellation, timeout and disposal of queued reads. Field
  tests retain rejection of duplicate, unsafe, uncertified and mismatched values.
- Initial development run `8bb423e0-accf-4f2f-aa97-2d53c7bb2df9` failed field
  certification because it incorrectly depended on native tree completeness.
  It is retained separately.
- Run `d8e0591d-8b22-4a63-89d1-4edd541065a4` completed 48 passing attempts but was
  invalidated by source drift after a same-name parent/child boundary correction.
  It is excluded from final validation; every task was rerun on the final source.

Reproduce with the [maintained runner](../../../scripts/computer-benchmark/README.md):

```sh
pnpm run computer:benchmark
pnpm run computer:benchmark:check
pnpm run computer:benchmark:windows --repetitions 3
```

These changes are in source and were exercised through a freshly bundled Electron
benchmark worker. An existing installed desktop binary needs a rebuild/update to
use them. No personal application or provider account was used for this matrix.
