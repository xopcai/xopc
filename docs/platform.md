# Connect xopc to XOPC Platform

xopc works independently by default. Connecting it to XOPC Cloud or a privately deployed XOPC Platform adds centrally published services and an outbound runtime connection without replacing the local application.

## Choose a mode

| Mode | Use it when | Behavior |
| --- | --- | --- |
| `standalone` | You want one personal installation with your own models and services | Uses local configuration and explicit environment overrides. No Platform Discovery document is required. |
| `connected` | Your account or organization uses XOPC Cloud or an enterprise deployment | Reads one versioned Platform Discovery document and uses only the capabilities and endpoints it advertises. |

`standalone` is the default. It does not mean every model must run locally: a provider you configure can still receive the context needed for a request. See [Models and providers](./models.md) for that data boundary.

Connecting does not upload the local xopc SQLite database, Sessions, workspace files, credentials, or user model. Those remain governed by the local installation unless a separate, explicit feature sends data to a configured service.

## Connect and inspect

```bash
xopc platform connect https://console.xopc.ai
xopc platform status
xopc platform status --refresh
```

For a private deployment, replace the URL with its public console URL. To select a default workspace when the deployment provides more than one:

```bash
xopc platform connect https://xopc.example.com --workspace workspace-id
```

The connect command fetches `/.well-known/xopc-platform`, validates the versioned document, and stores it under `platform` in the active `xopc.json`. `status --refresh` validates and replaces the stored discovery snapshot. A failed refresh does not silently invent or fall back to undiscovered private endpoints.

Return to independent operation with:

```bash
xopc platform disconnect
```

Disconnecting removes the active Platform Discovery configuration. It does not revoke a runtime registration or delete its credential on the remote platform; an administrator must revoke that registration separately when required.

## What discovery controls

A platform can advertise authorization, model, Store, tunnel, Share, runtime-fleet, realtime, and A2A endpoints. xopc adopts only endpoints present in a valid discovery document. Explicit command options and supported environment overrides continue to take precedence over discovered values.

The discovery document also declares protocol versions and capability flags. An endpoint alone does not enable a capability whose flag is false. Unknown or malformed contract fields fail validation instead of activating compatibility behavior.

A2A is a platform-facing gateway capability. xopc recognizes the advertised `a2aApi` and protocol version, but this release does not add a local `xopc a2a` client command. A connected xopc runtime can execute work scheduled by the platform through the runtime-fleet protocol.

## Register this installation as a runtime

An organization administrator first creates a runtime registration in XOPC Platform and gives the operator its one-time `xopc_rt_…` token. Store it without exposing it in shell history:

```bash
printf '%s' "$RUNTIME_TOKEN" | xopc platform runtime token set --stdin
xopc platform runtime heartbeat
```

The token is stored in the xopc credential store, not in `xopc.json`. A deployment can instead inject `XOPC_PLATFORM_RUNTIME_TOKEN` at process start.

`runtime heartbeat` verifies authentication and retrieves current policy information; it does not start a background worker. Packaged worker deployments use the exported runtime adapter to lease commands, renew leases, observe cancellation, and report ordered terminal events. The platform token scopes the runtime identity and must not be shared between installations.

## Security and operations

- Use HTTPS for cloud and enterprise platform URLs.
- Treat the discovery document as public routing metadata, never as a place for secrets.
- Pass runtime tokens through an interactive prompt, standard input, a credential store, or a secret manager—not a committed config file.
- Revoke a lost or retired runtime token in the platform control plane.
- Run `xopc platform status --refresh` after a platform upgrade that changes published endpoints.
- Use `xopc platform status --json` for automation; it does not include the runtime token.

For the complete command list, run `xopc platform --help` and `xopc platform runtime --help`.
