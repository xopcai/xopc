# Chat progress: Mate 60 acceptance

Date: 2026-10-25 (Asia/Shanghai). Device: HUAWEI Mate 60, BRA-AL00, OpenHarmony-7.0.0.105.

The updated `ai.xopc.xopc` 0.1.15 Debug HAP was signature-verified and installed with `hdc install -r`, preserving pairing and conversation history. Signing reused the local configuration from the earlier phone-workspace deployment. No signing material was added to source control. Final HAP SHA-256: `18b6120d9b45845b1c69c74a0e152527d881abab0bb63f2ece75cf214e2bb769`.

Verification used the separate conversation “消息阶段真机验收 2026-10-25” (`aa7cf30e-3373-4777-a273-49180016832f`) through the paired Gateway and a real agent run. The test requested public progress messages separated by short terminal sleeps, without file changes, network requests or device actions by the agent.

| Check | Observed result |
| --- | --- |
| Public progress | Six distinct natural-language messages appeared in order, without UI-added numbering. All six remained expanded; no disclosure button or item limit was present. |
| Alignment | UI-tree bounds confirmed the same left edge for all six messages. Screenshots confirmed left-aligned text. |
| Running indicator | The animated dots stayed below the final progress message. |
| Completion | After the real run finished, its progress messages and dots disappeared; only “全部进展展示验收完成” remained for that response. |
| Stop | An earlier test run was stopped using the phone's Stop button. The incomplete status remained visible and the dots disappeared. That status also remained after subsequent app updates/restarts. |
| History/realtime reconciliation | An initial device run exposed duplicate public messages under different history/realtime IDs. Presentation now deduplicates normalized public narration within the response; the final six-message test contained no duplicates. |

The former disclosure count also exposed a numeric string-resource substitution problem. Disclosure controls were subsequently removed entirely at the user's request, along with the associated resources and count limits. Progress text has no two-line UI clipping.

The targeted host suite passed 84 tests in four files; the final Debug HAP build and `git diff --check` passed. This acceptance covers the connected phone's message presentation and stop flow. It does not independently establish failure/confirmation journeys, personal-agent device parity, weak-network resilience, accessibility or release readiness.

Ignored local evidence: `apps/mobile-harmony/.test/chat-stages-device-20261025/`, including `all-progress.jpeg/json`, `final-result.jpeg/json`, `interrupted.jpeg/json`, `final-checks.json`, and `deployment.json`.
