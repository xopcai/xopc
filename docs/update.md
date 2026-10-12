# Update xopc

Update through the same installation method you originally used. Back up local state before a major update or when important Agents, Workflows, channels, or extensions are configured. For a verified offline backup, stop the Gateway and follow [Back up and restore xopc](./backup.md).

## Check the current version

```bash
xopc --version
xopc update --check
```

## Desktop app

Use **Settings → Gateway** when an in-app update is offered, or download the current installer from [xopc.ai](https://xopc.ai/en#download). Historical artifacts remain available on [GitHub Releases](https://github.com/xopcai/xopc/releases). Close other xopc windows before replacing the application.

## Command-line installation

```bash
xopc update
```

If xopc was installed globally through npm, you can also use:

```bash
npm install -g @xopcai/xopc@latest
```

## Docker

Pull the selected tag and recreate the container while keeping the state volume:

```bash
docker pull ghcr.io/xopcai/xopc:latest
docker compose up -d
```

For predictable deployments, pin a version instead of `latest`.

## After updating

```bash
xopc --version
xopc config validate
xopc doctor
xopc gateway health
```

Then test one model call and each important channel or extension. Review release notes for new required settings, permission changes, or migration notes.

## If an update fails

1. Record the old and attempted versions.
2. Read the first update or startup error in the logs.
3. Confirm the state directory is writable and has free disk space.
4. Check extension compatibility.
5. Avoid deleting the state directory; it contains your local data.

Package installation and Gateway activation are separate steps. The updater loads service-management modules before replacing package files and still schedules a process restart if extension synchronization or service-definition refresh fails. A failed restart is reported as an error with the installed version and restart details, rather than a successful update.

Before activating a staged npm installation, the updater loads the candidate's Gateway module graph in a fresh process with a temporary state directory. Missing dependency exports and incomplete builds fail verification before the old package and CLI shim are replaced. This does not start a second Gateway or access the live database.

If the package is already current but the running Gateway is older, retrying the update from the console schedules the missing restart without reinstalling. CLI daemon updates verify readiness and the running version through authenticated `/api/status`; an unverified version or timeout is reported as a restart failure. An in-process update reports a scheduled restart; verify the running version after reconnecting. `--no-restart` and `commands.restart=false` still require a manual restart.

See [Release channels](./releases.md) for stability choices and [Back up and restore xopc](./backup.md) for recovery steps. If a new version migrated the database, restore its matching pre-update backup before running an older binary.

## Maintainer release checks

Pin the Pi runtime packages (`pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-codemode`, `pi-mcp`, `pi-tui`, and `chord`) as exact direct dependencies from the same tested release. The workspace lockfile and pnpm overrides alone do not constrain an end user's npm dependency resolution. For example, xopc 0.0.381's pi-coding-agent 1.1.0 accepted pi-codemode 1.2.0 through an upstream caret range, but could not load its removed `MCP_TYPESCRIPT_PREAMBLE` export.

After building, run `pnpm run release:check-package` and `pnpm run release:smoke-package`. The second check packs the artifact, installs it into an empty npm prefix without the workspace lockfile, checks Pi versions as resolved by pi-coding-agent, and starts an isolated Gateway to verify readiness and authenticated running-version status. To test an existing artifact, pass its path as `pnpm run release:smoke-package /path/to/xopc.tgz`. npm is used only inside this isolated check to reproduce user installations; manage repository dependencies with pnpm.

Both checks gate the patch-release script and npm publishing. CI tests the exact tarball that will be published before uploading it as the release artifact. A source-only fix takes effect for users after a new package version is published. An upgrade initiated by an older running updater still uses that updater's checks; the new pre-activation check applies to subsequent upgrades after the fixed version is running.
