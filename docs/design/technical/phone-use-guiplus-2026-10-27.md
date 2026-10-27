# GUI-Owl hosted API / Bailian GUI-Plus acceptance — 2026-10-27

The [official GUI-Owl / MobileAgent project](https://github.com/X-PLUG/MobileAgent/blob/main/README_zh.md)
links its Bailian hosted API to `gui-plus-2026-02-26`. This is the vendor's
GUI-Plus product name, not a claim that it is an identical open-weight 8B checkpoint.
The [GUI-Plus documentation](https://help.aliyun.com/zh/model-studio/gui-automation)
requires a Beijing-region key and supports OpenAI-compatible image requests.
No model weights were deployed locally or on the platform.

## Other checked services

- ModelScope's two `iic/GUI-Owl-1.5-8B-*` IDs remained unavailable after email
  verification. Their services remain unpublished drafts.
- The [legacy Bailian UI Agent API](https://help.aliyun.com/zh/model-studio/ui-agent-api)
  uses a different Agent API envelope and older `pre-gui_owl_7b` identifier.
- [Featherless lists GUI-Owl 1.5 8B Instruct](https://featherless.ai/models/mPLUG/GUI-Owl-1.5-8B-Instruct)
  and documents a [vision API](https://featherless.ai/docs/vision). It requires a
  separate key; it was not live-tested because the existing Bailian key worked.

## Configured routes

| Route | Model reference |
|---|---|
| Local BYOK | `dashscope-phone/gui-plus-2026-02-26` |
| Managed Cloud | `xopc-cloud/phone-gui-plus` |

The client adds the **Alibaba Bailian · Phone Use** preset with image input,
Chat Completions and `gui-owl-phone-v1`. It uses the native `mobile_use` grammar.
The prompt distinguishes launching an app from navigating an internal Settings page.

The Cloud service reuses the existing compatible encrypted Bailian key/pool.
Publication and route compatibility project the dated GUI-Plus model onto the
phone protocol only for `phone-gui-plus`. A live catalog check confirmed that
`computer` retains its computer profile and the new phone product has no computer
capability. Fixed routing and one upstream attempt remain enforced. Existing
key-model discovery entries and upstream pool limits were preserved. The new
service inherits the existing phone pricing and per-user quota policy.

No new key was needed. For another account, follow
[Get an API key](https://help.aliyun.com/zh/model-studio/get-api-key), select
**Beijing**, create/copy a key authorized for this model, and enter it through
Gateway provider settings. A ModelScope Token cannot replace a Bailian key.

## Real-device results

Device: registered Aliyun Android test phone, `SM-F900F`. An authenticated isolated
Gateway started from Settings and asked each model to open Display and expose
Font size / Display size without changing settings.

| Route | Model requests | Native actions | Result |
|---|---:|---:|---|
| Local BYOK | 2 | 2 | completed, verified |
| XOPC Cloud | 2 | 2 | completed, verified |

Both reached `condition_satisfied`. An independent accessibility reader checked
the app, target text and bounds inside the viewport; screenshot inspection
confirmed the Display page. Sampled brightness, brightness mode, screen timeout
and font scale stayed unchanged. Cloud reconnect preserved the explicit
independent model in each successful isolated run.

An initial local trial was blocked with `PHONE_APP_DENIED` after entering search.
Clarifying internal-page navigation fixed the tested task without relaxing the
app allowlist. The first Cloud real-device trial hit the existing account
concurrency limit (`Retry-After: 5`). After capacity became available, the Cloud
screenshot request and real-device trial passed. Quotas were not increased.
Acceptance covers this navigation task, not arbitrary-app success.

Evidence: `~/.xopc/reports/phone-use-guiplus-2026-10-27/` contains `result.json`,
`local.png`, and `cloud.png`. Temporary isolated Gateway state and the remote
provisioning helper were removed. The live local default remains Doubao BYOK.

```sh
XOPC_PHONE_REAL_MODEL=1 \
XOPC_PHONE_MODEL_REFS=dashscope-phone/gui-plus-2026-02-26,xopc-cloud/phone-gui-plus \
XOPC_PHONE_EVIDENCE=/tmp/xopc-guiplus-phone-check \
node --import tsx scripts/verify-phone-cloud-e2e.mts
```

Validation: 513 phone/preset tests passed (one skipped), root/Electron and web
typechecks passed, Node and web builds passed. The prepared platform release
passed 314 gateway tests (one skipped), typechecking and build. Deployment/public
health checks passed. Changes remain available locally for review.

Subsequent cleanup removed the unavailable ModelScope GUI-Owl drafts and left
only the verified Doubao Pro and Bailian phone entries in the current Workspace.
See [the cleanup record](phone-preset-cleanup-2026-10-27.md).
