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

## Phone dependencies

Settings → Phone Use and Runtime Tools share a dependency card. Checks never download software automatically. Administrators explicitly install or repair tools on the **Gateway host**, including the local computer for Electron’s embedded Gateway. Existing Android SDK installations are reused; no global installation or full Android Studio is required.

- **ADB / Platform Tools:** needed for local USB phones and emulators. Alibaba Cloud’s direct ADB transport does not require a host ADB executable. Configure an absolute Gateway-side executable path, or use automatic SDK/managed/PATH discovery.
- **scrcpy server:** needed for live video and continuous touch. Snapshot mode remains available without it. Existing server files can be imported by Gateway-side path; their version and pinned SHA-256 must match before they are copied into managed storage.

```sh
xopc runtime status --phone
xopc runtime install adb
xopc runtime install scrcpy
xopc runtime repair scrcpy
```

Managed versions are Platform Tools 37.0.1 and scrcpy server 3.3.3. ADB distributions cover macOS arm64/x64, Windows x64 and Linux x64; other hosts may supply an existing compatible ADB (Platform Tools 31 or newer). Close active phone sessions before changing or repairing ADB through the UI. The installer does not restart ADB or send phone input.

The runtime proxy, download timeout and offline bundle directory also apply. Offline files use the exact catalog filenames: `platform-tools_r37.0.1-darwin.zip`, `platform-tools_r37.0.1-linux.zip` or `platform-tools_r37.0.1-win.zip`, and `scrcpy-server-v3.3.3`. Pinned hashes remain mandatory. Online phone downloads use the official Google and scrcpy sources. A `website-only` policy requires an offline bundle or an explicit change to Auto/Direct; it is never silently bypassed.

Official distributions and licenses: [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools), [scrcpy 3.3.3](https://github.com/Genymobile/scrcpy/releases/tag/v3.3.3). Archive license files are retained.
