# Phone preset cleanup — 2026-10-27

The live authenticated Gateway phone-model endpoint now returns exactly four
configured entries, representing the two real-device-verified models:

- `volcengine-ark/doubao-seed-2-1-pro-260915`
- `dashscope-phone/gui-plus-2026-02-26`
- `xopc-cloud/phone-doubao`
- `xopc-cloud/phone-gui-plus`

The two unavailable ModelScope GUI-Owl presets, their unpublished Cloud service
drafts and provider inventory rows were removed. The helper that recreated those
drafts was removed. ModelScope is now a general-inference preset, with its Token
preserved. The unverified Seed Lite preset and local legacy AutoGLM model entry
were removed as well.

Legacy Cloud `phone` (AutoGLM) is disabled only in the requesting Workspace's
model-access policy, preserving its existing service for other Workspaces. New
Cloud setup prefers `phone-doubao`, then `phone-gui-plus`; explicit user choices
remain authoritative. Legacy adapters remain for historical/custom model use.

The local default remains Doubao Pro. The final live check asserted the exact
four-model list, all credentials configured, the unchanged default, retained
ModelScope credentials and HTTP 200 Cloud health. Evidence is in
`~/.xopc/reports/phone-preset-cleanup-2026-10-27/result.json`.

Validation: 529 relevant tests passed (one skipped); root/Electron and web
typechecks and Node/web builds passed. The scoped Cloud release passed 309
gateway tests (one skipped), typechecking/build and deployment health checks.
No native phone actions were needed for this configuration cleanup; the two
retained models' real-device acceptance records remain the source of that proof.
