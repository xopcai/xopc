# Back up and restore xopc

`xopc backup` creates an encrypted, verifiable copy of one offline xopc state directory. It is the first building block for moving an instance to another computer. Automated cloud migration and automatic client or domain cutover are still in design.

## Before you start

1. Find the active state directory with `xopc profile list` and `xopc config path`.
2. Stop the Gateway and all other xopc processes using that database. Wait for active Agent runs and Automations to finish or stop them deliberately.
3. Prepare a passphrase file outside the state directory. Use a strong, unique passphrase of at least 12 characters. On Unix, restrict the file with `chmod 600 /secure/passphrase`. Store the passphrase separately from the backup.
4. Choose a new output directory outside the state directory. Its parent directory must exist.

## Create and verify

```bash
xopc backup create --output /secure/xopc-backup --passphrase-file /secure/passphrase
xopc backup verify /secure/xopc-backup --passphrase-file /secure/passphrase
```

`create` refuses a database held open by another detected process. It makes a consistent SQLite snapshot, encrypts each included file with AES-256-GCM, and writes an encrypted manifest. `verify` checks authentication tags, file hashes, and SQLite integrity. The backup directory and its files are created with owner-only permissions on Unix.

The backup includes the database, configuration, credentials, Agent profiles, installed Skills and extensions, attachments, and workspaces **inside the active state directory**. It excludes logs, caches, downloaded tool runtimes, and live process files. It cannot include drafts or offline operations that a mobile client has not sent to the Gateway.

This version rejects **known** external config, credential, or Agent workspace paths instead of producing a misleadingly complete archive. It does not discover every path a custom extension might use. If xopc reports an external path, back up that path separately and review how its references will work on the target machine. Do not present the resulting files as a tested one-click migration.

## Restore

```bash
xopc backup restore /secure/xopc-backup --target /new/.xopc --passphrase-file /secure/passphrase
```

The target must not exist. Restore decrypts into a temporary directory, checks every file and SQLite integrity, then publishes the directory. A failed restore removes its temporary files and does not replace an existing state directory.

Before starting the restored Gateway, use a compatible xopc version; review absolute paths, ownership, external workspaces, OAuth callbacks, channel credentials, device pairing, and the public URL. Some machine-bound credentials must be authorized again. Keep the original instance stopped when activating the restored one so channels and Automations do not run twice.

## Upgrades and Docker

Create and verify a backup **before** installing a version that may migrate the database. Restoring older application binaries over a database already upgraded by a newer version is not a safe rollback; restore the matching pre-upgrade backup into a new directory. See [Update xopc](./update.md).

For Docker, stop the Gateway container first. Mount the persistent state volume and separate output/passphrase locations into a one-off xopc CLI container, then run the same commands there. The output must be on a separate mount outside `/home/node/.xopc`; otherwise `create` refuses it. A container-only path that disappears when the container is removed is not a backup destination. See [Install with Docker](./docker.md).

For manual backups that include external workspaces or unusual extensions, follow the [data and file locations](./workspace.md) checklist and test a restore on an isolated machine.
