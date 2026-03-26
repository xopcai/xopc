# Onboarding: channel selection and plugin-driven setup

This document describes how **xopcbot** aligns with the OpenClaw-style model for interactive onboarding: pick channels, then run each channel’s guided setup based on **bundled channel plugins** and optional **`ChannelSetupWizard`** metadata.

## Reference architecture (OpenClaw)

OpenClaw combines:

- A **plugin registry** (`listChannelSetupPlugins`) with bundled fallbacks.
- **Discovery** (`resolveChannelSetupEntries`): core channel list + installed plugins + catalog entries (installable vs installed).
- **`ChannelSetupWizardAdapter`**: `getStatus`, `configure`, optional `configureInteractive`, DM policy hooks, `afterConfigWritten`.
- **`setupChannels`** (`onboard-channels.ts`): status summary → multi-select loop → install catalog plugin if needed → enable bundled plugin → run adapter → optional DM policy pass → post-write hooks.

See the OpenClaw tree: `src/commands/onboard-channels.ts`, `src/commands/channel-setup/`, `src/channels/plugins/setup-wizard-types.ts`, `src/channels/plugins/setup-registry.ts`.

## Current xopcbot design

### Goals

1. **Single CLI entry** for channel onboarding: `xopcbot onboard` (or `--channels`) runs one flow.
2. **Dynamic list**: a first-class **Telegram** configurator in core, plus any **bundled** `ChannelPlugin` that exposes `setupWizard` and is not overridden. Additional channels (e.g. Slack, Discord) belong in **extensions** with their own `setupWizard` / onboarding when implemented.
3. **Persistence**: channel subtrees must survive `ConfigSchema.parse` on save (see `src/config/loader.ts`).

### Implementation map

| Piece | Location |
|-------|----------|
| Multi-channel loop (select channel or Done) | `src/cli/commands/onboard/channels/index.ts` |
| Registry (order + overrides + wizard bridge) | `src/cli/commands/onboard/channels/registry.ts` |
| Declarative `ChannelSetupWizard` → `ChannelConfigurator` | `src/cli/commands/onboard/channels/wizard-to-configurator.ts` |
| Telegram (full DM/group policies) | `src/cli/commands/onboard/channels/telegram.ts` |
| Bundled plugins | `src/channels/plugins/bundled.ts` |
| Wizard schema | `src/channels/plugins/types.adapters.ts` (`ChannelSetupWizard`) |

### Override rule

If a channel id is handled by an explicit configurator (e.g. `telegram`), the **declarative** `setupWizard` from the same bundled plugin is **not** registered twice. Extensions without a dedicated configurator can still ship **`setupWizard`** only and rely on the generic runner.

### Future work

- **Catalog / install**: optional npm or path-based install (OpenClaw `ensureChannelSetupPluginInstalled`).
- **Non-interactive onboard**: env-based shortcuts using `envShortcut` on `ChannelSetupWizard`.
- **Gateway Web UI**: REST + SSE steps mirroring the same registry (after CLI is stable).
- **Tests**: colocated vitest for `getChannelConfigurators` once workspace extensions resolve under the test runner (or mock `bundled.ts` at the package boundary).

## Related commands

- `xopcbot onboard` — full wizard  
- `xopcbot onboard --channels` — channels only  

_Last updated: 2026-03-26_
