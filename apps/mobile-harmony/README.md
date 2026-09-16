# xopc HarmonyOS

Native ArkUI / ArkTS Stage application. The Gateway runs the agent; the phone is a secure client, not a Node.js host or WebView wrapper.

**Status: development preview, not release-ready.** Builds use SDK 26 with a minimum runtime of HarmonyOS 6.1 / API 23. Tests distinguish host logic, native platform integration and real-device acceptance; see [verification](docs/verification.md) and [release gates](docs/release.md).

## Open and build

Open this directory in DevEco Studio. Tested tooling: DevEco / command-line-tools 26.0.0.821, Hvigor 6.26.4, OHPM 26.0.0.630, SDK 26. The compatible SDK is `6.1.0(23)` and target SDK remains `26.0.0`. The minimum targets Mate 60 on HarmonyOS 6.1; physical-device acceptance is still required. Earlier API versions are not supported.

```sh
# In apps/mobile-harmony; Harmony packages use OHPM, Node packages use pnpm.
ohpm install
hvigorw assembleHap --mode module -p module=entry@default -p product=default --no-daemon
```

The unsigned output is `entry/build/default/outputs/default/entry-default-unsigned.hap`. The registered bundle is `ai.xopc.mobile` (AGC APP ID `6917616647856901107`), version `0.1.0` / code `1`. Configure signing before device distribution. Keep certificates, private keys, passwords and AGC service-account files outside source control. No signing secrets or machine-specific SDK paths are committed to the app configuration. See [GitHub Actions and phone testing](docs/ci.md).

## Verification

From the repository root:

```sh
pnpm harmony:verify --host-only
HARMONY_TOOLS_DIR=/absolute/path/to/command-line-tools pnpm harmony:verify
```

The full command checks generated contract fixtures, client and selected backend tests, root TypeScript types, debug/release HAP builds and CodeLinter. It does not deploy, publish, migrate your normal database, or claim real-device acceptance. When command-line tools are on PATH, `HARMONY_TOOLS_DIR` is optional.

## Native instrument tests

Use a disposable emulator containing no real xopc account. Finish its keyboard onboarding first. Installing with `-r` preserves application data; UI tests expect an **unpaired** app and temporarily change appearance/language. Do not clear a user's app data to satisfy this prerequisite.

1. From repository root, run `pnpm harmony:test:server`. This generates an ephemeral CA in **ohosTest-only** resources and opens a temporary SQLite database; its HTTPS server binds only `127.0.0.1:9443`. Approval is automatic only inside this isolated harness. Keep it running through the test.
2. From this directory, build both HAPs:

```sh
hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=debug --no-daemon
hvigorw assembleHap --mode module -p module=entry@ohosTest -p product=default --no-daemon
hdc -t DEVICE rport tcp:9443 tcp:9443
hdc -t DEVICE install -r entry/build/default/outputs/default/entry-default-unsigned.hap
hdc -t DEVICE install -r entry/build/default/outputs/ohosTest/entry-ohosTest-unsigned.hap
hdc -t DEVICE shell aa force-stop ai.xopc.mobile
hdc -t DEVICE shell aa test -b ai.xopc.mobile -m entry_test -s unittest OpenHarmonyTestRunner -s class XopcNativeSecurity,XopcNativePairing -s timeout 60000 -w 90
hdc -t DEVICE shell aa force-stop ai.xopc.mobile
hdc -t DEVICE shell aa test -b ai.xopc.mobile -m entry_test -s unittest OpenHarmonyTestRunner -s class XopcUiSmoke -w 90
```

Inspect `OHOS_REPORT_RESULT`: HDC's exit code can be zero even when a test fails. Expected results are 4/4 security + pairing and 1/1 UI. Stop the harness with Ctrl-C after testing (it removes only its own temporary database/certificate directory), inspect `hdc -t DEVICE fport ls`, and remove only the test's forward with `hdc -t DEVICE fport rm tcp:9443 tcp:9443`. The public test CA is ignored by Git and never included in the production HAP. Production transport retains normal TLS validation and rejects HTTP/redirects.

## Implemented preview surfaces

| Area | Implementation | Acceptance boundary |
| --- | --- | --- |
| Connection | Paste/Scan Kit invitation, explicit Gateway approval, identity verification, refresh recovery, Asset Store credentials | Native TLS pairing and restart/rotation pass; camera scan on physical device pending |
| Chat | Session list/search/create/rename/pin/archive/reset/delete, history, Markdown, text/file/image input, stream/abort, reconnect/gap recovery | Logic/contract tests pass; real agent streaming and lifecycle journey pending |
| Work | Tasks, projects, scheduled automations and execution history | API-shaped CRUD/actions; full cross-client journey pending |
| Notes/files | Notes CRUD/search/Markdown; file spaces/search/text edit/delete and system picker transfer | Native picker + Gateway transfer on device pending |
| Voice | Permission-gated recording, 120-second cap, playback, Gateway transcription into draft | Lifecycle tests pass; physical audio and actual transcription pending |
| Notifications | Separate Huawei V3 server provider, native token registration, foreground handling and safe click routing | Requires AGC app identity, Push Kit configuration and real delivery test |
| Settings | Chinese/English/system language, light/dark/system theme, local disconnect | Emulator UI smoke passed |

Explicit preview limits: one paired Gateway; file-manager upload 8 MiB, download 16 MiB, text preview 1 MiB; chat attachments up to 10 files, 10 MiB each and 20 MiB total, selected through the system document picker; voice upload 4 MiB; no background recording. Historical attachments show their names, not inline media previews. Markdown is a native basic renderer (no HTML, remote-image fetch, rich editor or tables). No Live View, cards, live voice conversation or distributed-device features. Large-data pagination/layout/performance and accessibility are release gates, not implied by a successful build.

## Architecture and contracts

`view/` → `viewmodel/` → `repository/` → `service/`. `common/` contains portable parsers, canonical signing bytes and cursor handling; `model/` contains explicit ArkTS DTOs. State uses `@ObservedV2` / `@ComponentV2`. Only platform services depend on native kits.

Gateway schemas remain authoritative. Regenerate `fixtures/gateway-contract.json` with `pnpm exec tsx apps/mobile-harmony/scripts/export-contracts.mts`; `--check` detects drift. JSON Schema does not encode every custom refinement, so rejection tests remain mandatory.

Asset Store values are chunked below its record limit with an atomic manifest pointer; access tokens remain memory-only. Retries retain the same pairing/refresh/input identities. A killed process before manifest commit can leave encrypted orphan chunks; storage-pressure/crash testing remains required. Nothing logs pairing links, keys, tokens or message bodies.

## Huawei push setup

Gateway environment (server only):

```sh
XOPC_HARMONY_PUSH_SERVICE_ACCOUNT=/absolute/private/path/service-account.json
XOPC_HARMONY_PUSH_CATEGORY=WORK
XOPC_HARMONY_PUSH_TEST_MESSAGE=true
```

Choose an explicitly authorised category (`WORK`, `IM` or `MARKETING`); the example is not an assertion that the app has category approval. The service-account JSON contains `project_id`, `key_id`, `sub_account`, `private_key`. The server signs PS256 JWTs and sends Huawei V3 notification requests. The client never receives this file. Expo tokens/provider remain separate. Missing configuration returns 503 at registration rather than a false success.

A Huawei request ID means **provider acceptance**, not device delivery. Device taps acknowledge through the existing Gateway endpoint; do not count all accepted pushes as delivered. See [Huawei JWT guide](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/push-jwt-token) and [V3 request reference](https://developer.huawei.com/consumer/en/doc/harmonyos-references/push-scenariozed-api-request-param).
