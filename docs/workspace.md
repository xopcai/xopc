# Data and file locations

xopc keeps its machine-local state under one directory and gives each Agent a separate working folder. Knowing the difference makes backup, privacy review, and troubleshooting much easier.

## Default locations

The default state directory is `~/.xopc/`.

| Path | Contains | Handle as |
| --- | --- | --- |
| `~/.xopc/xopc.json` | Main configuration | Private; may reference credentials and network settings |
| `~/.xopc/xopc.db` | Sessions, user context, Automations, and other local records | Private and important to back up |
| `~/.xopc/credentials/` | API, OAuth, channel, and pairing credentials | Secret |
| `~/.xopc/agents/<id>/profile/` | Agent identity and instruction Markdown | User-editable, usually private |
| `~/.xopc/workspace/<id>/` | Files and artifacts used by an Agent | User data |
| `~/.xopc/skills/` | Installed Skills | Review before trusting |
| `~/.xopc/extensions/` | Installed extensions | Review before trusting |
| `~/.xopc/logs/` | Runtime and diagnostic logs | May contain private metadata |
| `~/.xopc/tools/` | Managed Node.js and Python runtimes | Re-creatable cache/runtime data |

An Agent can be configured with a different workspace path, so use its editor or `xopc config show` before assuming the default.

## State, Agent profile, and workspace

- **State** is xopc's local database, configuration, credentials, logs, and installed capabilities.
- **Agent profile** describes who an Agent is and how it should behave.
- **Workspace** contains the files that an Agent reads and creates while doing work.

Do not store model keys in the workspace. Do not treat workspace Markdown as a replacement for the local Session database.

## Find the active paths

```bash
xopc profile list
xopc config path
xopc config show
```

Profiles may use directories such as `~/.xopc-work`. Environment variables and command-line options can also override paths.

## Back up

For a consistent full backup:

1. stop or pause active Agent runs and Automations;
2. stop the Gateway service;
3. copy the active state directory to encrypted storage;
4. separately include any Agent workspace located outside that directory;
5. restart the Gateway and verify health.

The backup contains credentials and private conversations. Encrypt it, restrict access, and define a retention period.

Before restoring, keep a copy of the current state, use a compatible xopc version, and make sure file ownership is correct. Do not merge SQLite files manually.

## Safe manual editing

It is normally safe to edit Agent profile Markdown and ordinary workspace files. Use xopc commands or the UI for configuration, credentials, Sessions, Automations, Skills, and extensions.

Avoid manually editing `xopc.db`, lock files, credential stores, or files under managed runtime directories.

## Move or isolate state

Use `xopc profile` commands for reusable separate environments. Advanced path overrides include `XOPC_STATE_DIR`, `XOPC_CONFIG_PATH`, `XOPC_WORKSPACE`, `XOPC_CREDENTIALS_DIR`, and `XOPC_LOG_DIR`.

When using a system service or container, set absolute paths and confirm the service account can read and write them.
