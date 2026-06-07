# Updates

xopc can check for, install, and apply package updates from the npm registry (global install) or from a git checkout (fetch/rebase/build). After a successful core update, it **syncs lockfile-managed extensions** and **restarts the gateway** when appropriate (OpenClaw-aligned).

See also: [CLI `update`](./cli.md#update) · [Gateway update API](./gateway.md#updates) · [Extensions lockfile](./extensions.md#post-update-extension-sync) · [Configuration `update.*`](./configuration.md#update)

---

## Quick start

```bash
# Check only (no install)
xopc update --check

# Install from configured channel (default: stable)
xopc update

# Skip gateway restart after install
xopc update --no-restart

# JSON output (includes postUpdate.extensions / postUpdate.restart)
xopc update --yes --json
```

**Git checkout (dev):** `xopc update` runs `git fetch` / `rebase` / `pnpm install` / `build` / `doctor` in the package root. Use a **clean working tree** (commit or stash local edits first).

**Global npm install:** uses a staged install + atomic swap (not in-place `npm install -g`).

---

## Update channels

Configured in `~/.xopc/xopc.json` under `update.channel` (overridable with `xopc update --channel`):

| Channel | npm dist-tag | Typical use |
|---------|--------------|-------------|
| `stable` | `latest` | Production global installs |
| `beta` | `beta` | Pre-release testing |
| `dev` | `dev` | Bleeding-edge npm tag; git checkouts default here |

```json
{
  "update": {
    "channel": "stable",
    "checkOnStart": true,
    "auto": {
      "enabled": false,
      "stableDelayHours": 6,
      "stableJitterHours": 12,
      "betaCheckIntervalHours": 1
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `checkOnStart` | `true` | Gateway queries npm on startup (and on a schedule when auto-update is enabled) |
| `auto.enabled` | `false` | Apply npm updates automatically from the gateway (stable/beta only; never from a git worktree) |
| `auto.stableDelayHours` | `6` | Wait after first seeing a stable release before installing |
| `auto.stableJitterHours` | `12` | Random extra delay to spread stable rollouts |
| `auto.betaCheckIntervalHours` | `1` | Minimum hours between auto-update attempts for the same version (beta) |

Set **`commands.restart: false`** to disable automatic and SIGUSR1-based gateway restarts after updates.

---

## What happens on `xopc update`

1. **Core update** — detect install surface (git vs global npm), acquire update lock, run install steps.
2. **Extension sync** — refresh extensions listed in `~/.xopc/extensions.lock` (npm and xopc-store sources). On **`dev`** channel, extensions that also exist as **bundled** copies are skipped (bundled wins).
3. **Gateway restart** — unless `--no-restart` or `commands.restart: false`:
   - **CLI outside gateway:** daemon `service.restart()` when the LaunchAgent/systemd/task is loaded; otherwise unmanaged SIGUSR1 to the listener on the configured port.
   - **Inside gateway** (`XOPC_SERVICE_MARKER=1`): in-process respawn via `triggerGatewayProcessRestart()` (graceful HTTP shutdown + fresh PID).
   - **Auto-update from gateway startup:** same in-process restart path after a successful install.

Post-update details are returned on the CLI (`--json`) and in gateway API responses under `postUpdate`:

```json
{
  "postUpdate": {
    "extensions": {
      "status": "ok",
      "outcomes": [
        { "extensionId": "my-ext", "status": "updated", "message": "Updated my-ext: 1.0.0 -> 1.0.1." }
      ]
    },
    "restart": {
      "ok": true,
      "mode": "daemon",
      "message": "Gateway service restarted successfully."
    }
  }
}
```

Restart `mode` values: `in-process` | `daemon` | `unmanaged` | `skipped` | `disabled` | `failed`.

---

## Gateway console

The Web UI shows an update reminder when a newer npm version is available (`GET /api/update/status`). **Apply update** runs `POST /api/update/run/stream` (SSE progress), then extension sync and in-process restart on success.

Requires **admin** operator scope (`operator.admin`).

---

## Manual extension sync

`xopc extensions update` refreshes lockfile entries only (does not update the xopc core package). Core updates call the same sync automatically:

```bash
xopc extensions update          # all lockfile entries
xopc extensions update my-ext   # one extension
```

---

## Troubleshooting

### `spawn npm ENOENT` during update

The gateway or daemon often runs with a **minimal PATH** (no nvm/fnm). xopc prepends stable Node/npm paths at CLI and gateway startup (`ensureXopcCliOnPath`). If auto-update still fails:

1. Run `xopc update` from a normal terminal once.
2. Reinstall the gateway service: `xopc gateway service install --force`.
3. Ensure `npm` is on PATH for the service user (or use a global Node install outside nvm).

### Update skipped: `dirty`

Git-based update requires a clean working tree. Commit, stash, or discard local changes, then rerun `xopc update`.

### Update skipped: `not-global-install`

Non-git, non-global installs (e.g. `pnpm link`, local `node_modules/.bin`) are not auto-upgraded. Use your package manager, then restart the gateway.

### Extension sync failed (`post-update-extensions`)

A lockfile extension failed to reinstall. Fix the npm/store spec or network, run `xopc extensions update <id>`, then `xopc gateway restart`.

### Restart disabled or failed

- Check `commands.restart` in config.
- `XOPC_NO_RESPAWN=1` disables in-process respawn.
- Use `xopc gateway restart --wait 30s` manually after a successful update.

---

## Implementation map

| Area | Location |
|------|----------|
| Unified runner | `src/infra/update-runner.ts` (`runGatewayUpdate`, `runGatewayUpdateWithPostSteps`) |
| Global npm staged install | `src/infra/update-global.ts`, `src/infra/package-update-steps.ts` |
| Extension post-sync | `src/extensions/update.ts` |
| Restart policy | `src/infra/update-restart.ts` |
| Startup check / auto-update | `src/infra/update-startup.ts` |
| CLI | `src/cli/commands/update.ts` |
| Gateway API | `src/gateway/hono/routes/update.ts` |
