# Agent tool runtimes

xopc manages the Node.js and Python environments used by shell tools, managed jobs, stdio MCP servers, and skill dependencies. These runtimes are separate from the Node.js process that runs xopc itself.

## Lifecycle

- `xopc setup` and `xopc onboard` provision runtimes whose policy is `eager`. Use `--skip-runtimes` when setup must remain offline or deferred.
- `on-demand` runtimes are installed when an MCP server or skill first needs them.
- Shell and managed-job processes receive a sanitized environment with managed binaries at the front of `PATH`.
- Runtime archives are checksum-verified, extracted into staging, probed, and only then made active in the manifest.
- A failed repair restores the previous installation. `xopc runtime prune` never removes the active manifest target.

## Commands

```bash
xopc runtime status
xopc runtime install node
xopc runtime install python --version 3.12.11
xopc runtime repair python
xopc runtime prune
```

The same status, install, repair, policy, proxy, offline-bundle, and cleanup operations are available in **Settings → Tool runtimes**.

## Configuration

```json
{
  "runtimeTools": {
    "enabled": true,
    "node": {
      "enabled": true,
      "version": "22.23.2",
      "preference": "managed-first",
      "provision": "eager"
    },
    "python": {
      "enabled": true,
      "version": "3.12.11",
      "preference": "managed-first",
      "provision": "on-demand"
    },
    "uv": { "enabled": true, "version": "0.8.12" },
    "download": {
      "source": "auto",
      "gatewayBaseUrl": "https://xopc.ai/api/runtime/v1",
      "proxy": "http://127.0.0.1:7890",
      "timeoutMs": 600000
    },
    "retention": { "keepVersions": 2 }
  }
}
```

Preferences are `managed-only`, `managed-first`, `system-first`, or `system-only`. Provisioning is `eager`, `on-demand`, or `disabled`. A disabled provisioning policy still permits a compatible already-installed runtime; it only prevents automatic installation.

Download sources are `auto`, `website-only`, or `direct-only`. `auto` uses the verified xopc.ai artifact gateway first and falls back to the official upstream only for retryable connectivity failures. Invalid descriptors and checksum failures never fall back.

The gateway also mirrors uv's pinned Python Build Standalone archives. Interrupted Node.js and uv downloads resume from their verified `.partial` file when the server supports byte ranges.

## Offline bundle

Set `runtimeTools.download.bundleDir` to an absolute directory. Once set, runtime installation does not fall back to the network. Every archive must have either a sibling `<archive>.sha256` file or an entry in `SHASUMS256.txt`.

Node.js and uv keep their upstream archive names. Offline Python uses an xopc bundle archive with one top-level directory:

```text
python-3.12.11-darwin-arm64.tar.gz
python-3.12.11-darwin-arm64.tar.gz.sha256
```

The extracted Python root must contain `bin/python3` or `bin/python` on Unix, or `python.exe` on Windows. Supported platform ids are `darwin-arm64`, `darwin-x64`, `linux-x64-gnu`, `linux-arm64-gnu`, and `win32-x64`.

## Storage and isolation

Managed artifacts live under `~/.xopc/tools` (or `XOPC_STATE_DIR/tools`):

```text
tools/
  manifests/
  node/versions/
  uv/versions/
  python/versions/
  environments/skills/
  downloads/
  staging/
  cache/
```

Skill npm and uv dependencies are installed into deterministic, xopc-owned environments instead of machine-global package locations. Their binary directories are injected only into agent tool processes.
