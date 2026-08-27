# Update xopc

Update through the same installation method you originally used. Back up local state before a major update or when important Agents, Workflows, channels, or extensions are configured.

## Check the current version

```bash
xopc --version
xopc update --check
```

## Desktop app

Use **Settings → Gateway** when an in-app update is offered, or download the new installer from [GitHub Releases](https://github.com/xopcai/xopc/releases). Close other xopc windows before replacing the application.

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

See [Release channels](./releases.md) for stability choices and [Data and file locations](./workspace.md) for backup guidance.
