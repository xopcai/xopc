# Tool runtimes

Some Agent tools, Skills, and local MCP servers need Node.js or Python. xopc can manage isolated runtimes so these dependencies do not have to be installed globally.

## Check status

Open **Settings → Tool runtimes**, or run:

```bash
xopc runtime status
```

The status shows whether Node.js, Python, and related helpers are ready and which version is active.

## Install or repair

```bash
xopc runtime install node
xopc runtime install python
xopc runtime repair python
```

Use the version requested by the Skill or tool unless you have a compatibility reason to choose another one. Downloads are verified before a new runtime becomes active.

## Remove old versions

```bash
xopc runtime prune
```

Pruning removes unused retained versions; it should not remove the active runtime. Review the command output when disk space is important.

## Provisioning choices

- **Eager** installs during setup.
- **On demand** installs when a tool first needs the runtime.
- **Disabled** prevents automatic installation but may still use an already available compatible runtime.

Managed-first is the simplest default. System-only is appropriate when administrators control runtime installation separately.

## Offline or proxied environments

Use the Tool runtimes settings to configure a network proxy or a verified offline bundle directory. An offline bundle must match the operating system and CPU architecture and include checksums.

## Troubleshooting

- Download fails: verify proxy, DNS, TLS interception, and disk space.
- Checksum fails: discard the archive and download it again; do not bypass verification.
- Tool still cannot find Python or Node.js: restart the Gateway and inspect the tool's selected runtime.
- Permission denied: ensure the Gateway service account owns or can write the xopc tools directory.
