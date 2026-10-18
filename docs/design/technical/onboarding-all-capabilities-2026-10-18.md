# Onboarding capability configuration — 2026-10-18

## Findings

Desktop onboarding submitted `selected: ['chat']`, so completing the wizard did not apply the other supported model uses. OAuth setup filled absent media sections only; an existing disabled STT or realtime voice object remained disabled. OAuth setup also omitted background, task intents, and the optional computer model route. The local installation showed disabled OpenAI STT and disabled realtime voice alongside enabled Cloud TTS.

## Result

- Desktop and browser Cloud onboarding apply every eligible recommended use: chat, vision, image generation, background, transcription, speech, and conversation. Missing capabilities remain unselected and are disclosed on completion.
- Cloud defaults fill fast, reasoning, coding, review, vision, and understanding intents. Explicitly selected background/vision uses update their corresponding intents independently of chat.
- Speech and transcription setup also select compatible streaming models. Cloud voice recommendations use catalog ranking, availability, and voice mode support.
- The supported computer model is prepared during complete setup; `computer.enabled` stays false on new installations. Browser support remains enabled by default.
- Explicit CLI onboarding enables available Cloud media even when disabled config objects already exist. Ordinary OAuth reconnection preserves explicit choices. Selecting only chat in model settings preserves unselected uses.
- Existing automatic voice reply trigger preferences remain intact; enabling speech synthesis does not force every text reply to play aloud.

## Verification

- Regression: 164 tests across the setup engine, Cloud setup, CLI onboarding, OAuth, authenticated lazy routes, and React onboarding.
- Root and web type checks, targeted ESLint, and production web build pass. The build retains existing bundle size/dynamic import warnings.
- Real acceptance uses an isolated workspace and database, an access-token-only copy of the existing account credential, a running authenticated Gateway, and Chrome with a speech fixture. The original application config and copied-source credential are fingerprinted before/after the run.
- The browser test mounts the real onboarding component with the desktop bridge marker and reuses an existing account connection. It checks actual HTTP requests and persisted switches. It does not perform a new interactive OAuth authorization or use a packaged Electron binary.
- Coverage includes persisted all-use configuration, idempotence, CLI/Gateway equivalence, retained explicit OAuth choices, chat, image generation/understanding, TTS, STT, assistant/natural WebSocket audio, and React microphone capture/playback.
- First live run: natural voice returned `OMNI_PROVIDER_ERROR` (reference `00aedc60-1e2e-420e-9386-44f9a0cf3322`). A subsequent full run passed natural voice. This is an observed transient Cloud failure; catalog readiness alone cannot guarantee provider uptime.

Machine-readable results: [cloud-onboarding-all-capabilities-2026-10-18.json](./cloud-onboarding-all-capabilities-2026-10-18.json).

Re-run with a current authorized Cloud credential:

```sh
XOPC_CLOUD_ONBOARDING_LIVE=1 \
XOPC_CLOUD_ONBOARDING_REPORT=docs/design/technical/cloud-onboarding-all-capabilities-2026-10-18.json \
pnpm exec tsx scripts/cloud-onboarding-live-smoke.mts
```

This invokes real model services and uses account quota. It leaves the original config intact. A normal credential refresh may be necessary before starting if the access token is near expiry.
