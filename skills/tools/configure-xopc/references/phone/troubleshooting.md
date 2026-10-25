# Phone setup recovery

Re-inspect the original conversation; user saying done is not evidence. Preserve partial
configuration and healthy registrations. Explain the one next owner action, not every field.

- Model missing/unsupported: models.md; check the effective Agent Phone override, credentials
  and the real model test. Do not switch the chat model, use mock or fall back silently.
- Phone model free quota exhausted: stop retrying; this is not device authentication or ADB
  failure. Explain the returned retry delay, preserve configuration, close this test and confirm
  release. The owner can wait for reset or select an already configured compatible Phone model
  in product settings. Never silently switch providers, enable billing or buy credits.
- Temporary model HTTP 503: close and inspect actual dispatch first. If no uncertain input
  remains, at most one new test may be retried in this turn. After the second failed attempt,
  stop and report the external service problem. Never loop begin_verification to hide failures.
- ADB absent/corrupted/download failure: dependencies.md and actual progress diagnostics.
- USB unauthorized/offline/no device: local.md; the phone owner decides on the RSA prompt.
- Cloud authentication/timeout: aliyun.md; check key binding and endpoint reachability from
  Gateway. Request fresh private-key upload only in the product form, never in chat.
- Tool/app access denied: let the owner keep refusal, or change the intended Agent/device
  access in product settings and return here. No shell, another Agent or another phone bypass.
- Device busy: do not stop another conversation's session. Wait or let that owner release it.
- No progress, unknown dispatch or text unconfirmed: release this demo before retrying. Do not
  repeat input automatically. The user's goal has not been verified.
- Restart/lease pending: the saved plan survives, the runtime may not. Release checks the saved
  phone's lease; while still live it cannot claim release or create a second test. Wait and
  recheck. After confirmed expiry the owner starts a fresh test; old checks cannot pass it.
- Cancellation never resumes the old objective. Only a new user request can restart setup.
