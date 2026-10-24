# XOPC Cloud Phone Use — design and verification

Date: 2026-10-24 (Asia/Shanghai)

## Outcome

Platform publishes `phone`, backed by the existing standard BigModel connection
and encrypted credential. The client uses `xopc-cloud/phone` and existing Cloud
authorization. Missing global phone routes are filled during Cloud connection;
explicit global selections and per-Agent overrides remain authoritative.

## Findings

Before this change, xopc already supported independent Phone Use providers and
Agent overrides, but `createPhoneModel` explicitly rejected `xopc-cloud`. Remote
catalog types and persistence supported phone metadata, while Cloud discovery
dropped it. Login completion filled a dedicated Computer Use model but no phone
model. Platform lacked phone capability parsing, provider runtime metadata and a
public product allowlist entry.

The deployed platform already had one enabled `zhipu-cn` standard BigModel
connection with an active pool and one healthy encrypted key. Provisioning reused
that connection, pool and key. It did not create or copy a credential.

Vendor reference checked: [AutoGLM-Phone official documentation](https://docs.bigmodel.cn/cn/guide/models/vlm/autoglm-phone).
The standard endpoint is `https://open.bigmodel.cn/api/paas/v4`, upstream model
`autoglm-phone`; the documented context is 20K and maximum output is 2048.
The runtime uses 20,480 context tokens. Coding Plan endpoints are excluded.
The vendor currently describes a temporary free offer; no permanent vendor price
or availability is assumed.

## Configuration precedence

| Situation | Result |
| --- | --- |
| Connect Cloud with no global phone route | Set `xopc-cloud/phone` if available and protocol-compatible |
| Reconnect with an independent global phone route | Preserve it |
| Agent has a phone route override | Use the existing Agent override resolution |
| Phone service absent or unavailable in Cloud catalog | Do not invent a model or overwrite a route |
| User chooses another compatible model in Phone Use settings | Save the explicit independent selection |

Only model selection is completed. Phone control still requires the existing
Phone Use enablement, device registration and authorization. No fallback model is
silently selected when a phone request fails.

## Request path and limits

`phone_use` → Phone runtime → existing phone adapter → Cloud `/v1/chat/completions`
→ single fixed `zhipu-cn/autoglm-phone` target → existing upstream pool/key.

Discovery publishes `phoneUse.profile=autoglm-phone-v1`, image input,
Chat Completions and maximum output 2048. The dedicated model is excluded from
ordinary chat and vision recommendations in both services. Platform requires one
fixed target and makes at most one upstream attempt. Workspace access, pool
limits, usage accounting and Cloud run credit budget headers remain in effect.
The client resolves Cloud credentials again for each prediction so long phone
sessions can refresh their authorization. A credit-budget exhaustion stops further
requests in that run.

Phone requests allow 8 MiB overall, one embedded screenshot of at most 5 MiB and
16 MP. The unpublished vendor image tokenizer makes a precise admission estimate
unavailable. Platform therefore reserves the full context remaining after the
requested output; actual upstream usage settles the reservation. Base64 screenshot
bytes are never counted as language tokens. Near-exhausted quotas can be
conservatively refused.

The initial published service is a free preview: 10 requests/minute, one concurrent
request, 50 requests/day, 100,000 tokens/day, and 2048 maximum output tokens.
The existing upstream pool is unchanged. Commercial pricing can be set through the
existing service publication workflow.

## Deployment and verification

Only the model gateway was deployed. The preparation script merged the listed
phone files over live source, preserving unrelated changes. Activation verified
file hashes and included the generated shared chunks. Its scoped rollback backup
is `/var/www/xopc-phone-deployments/phone-20261024061605233`.
The gateway health check passed after deployment.

Verification completed:

- xopc: 242 relevant tests passed across 21 files before the final budget/refresh
  assertions; the final targeted adapter suite passed all 18 tests, including
  authorization refresh and budget exhaustion.
- Platform release stage: 41 test files, 299 tests passed; the opt-in existing live
  Computer Use test was skipped. Typechecking and release bundling passed.
- Local Platform authenticated API test: publication, phone metadata discovery and
  invocation routed to `autoglm-phone` passed within the 98-pass app test suite.
- Operator provisioning: real upstream adapter grounded a synthetic button before
  publishing the service with the existing key.
- Real Cloud client adapter: standard 5097-byte PNG and uncompressed 1,923,767-byte
  PNG both returned taps inside the generated button.
- Both live checks applied the actual Cloud completion function to a disposable
  in-memory Agent catalog, verified default `xopc-cloud/phone`, then set an
  independent `custom/phone` selection and verified reconnect preserved it.

No native phone actions or personal screenshots were used in the initial synthetic smoke tests.
These results establish configuration and model transport behavior, not real-app
end-to-end task success or a Phone Use benchmark.

The xopc source and Node build are updated locally. No npm release was published;
existing installed xopc processes need the updated build to gain this behavior.
Reproduction: `node --import tsx scripts/verify-managed-phone.mts` and add
`--large-frame` for the uncompressed request. Platform deployment/provisioning
instructions live in the sibling repository's `scripts/phone/README.md`.


## Actual cloud-phone acceptance, 2026-10-24 14:35 +08:00

At the user's request, acceptance used the registered **阿里云测试手机** (Android
model identifier `SM-F900F`). This was an actual Android cloud device, not a
physical USB phone. A separate temporary state directory and authenticated running
Gateway exercised the normal lazy routes; the original device registration and
user model defaults were preserved. Existing Cloud authorization and the independent
`ZHIPU_API_KEY` were used without printing or copying upstream secrets.

The actual Cloud connection completion function filled the initially absent global
phone route as `xopc-cloud/phone`. The Gateway exposed both configured phone
choices. Each run started from the system Settings main page, navigated into
Display settings, and received an independent native observation. Screenshots
were also visually inspected to confirm the Display page rather than relying on
the model's completion claim.

| Selected model | Model requests | Native actions | Independent UI check | Sampled settings unchanged |
| --- | ---: | ---: | --- | --- |
| `xopc-cloud/phone` | 2 | 2 | Passed | Yes |
| `phone-bigmodel/autoglm-phone` | 2 | 2 | Passed | Yes |
| `xopc-cloud/phone` after switching back | 2 | 2 | Passed | Yes |

Model selection was switched through authenticated `/api/global-defaults` updates;
each newly opened phone session reported the exact selected model. The independent
provider used the standard BigModel endpoint and its own key, rather than a second
alias for the Cloud transport. After stopping the temporary Gateway, reapplying
Cloud connection completion preserved the independent route in the persisted
isolated Agent catalog.

The first trial predicate matched the word “brightness” in a Settings-main-page
summary. That result was rejected after screenshot inspection. The accepted rerun
required distinct Display-page labels plus a native brightness title node, and
all three rounds navigated into the Display page. The rejected evidence is kept
separately under `/tmp/xopc-phone-cloud-e2e-rejected-weak-oracle`.

The four sampled settings were `screen_brightness`, `screen_brightness_mode`,
`screen_off_timeout`, and `font_scale`. All remained unchanged in every accepted
trial; this is a bounded check, not an exhaustive audit of Android settings.
No messages, purchases, app installation or account changes were tested.

Reproduce with:

```sh
XOPC_PHONE_REAL_MODEL=1 node --import tsx scripts/verify-phone-cloud-e2e.mts
```

The harness requires an enabled registered cloud test phone and an exported
`ZHIPU_API_KEY`. Override the default phone name with `XOPC_PHONE_DEVICE_NAME`.
It checks for an existing unexpired device lease, closes its sessions and temporary
Gateway, and removes its isolated state. Final screenshots and metadata are local
artifacts at `/tmp/xopc-phone-cloud-e2e-evidence`; credentials are not included.
Final related regression: 42 tests passed. Both live verification scripts also
passed TypeScript checking with the repository compiler options.
