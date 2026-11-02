# Code signing policy

Status: SignPath application preparation. xopc has not yet been accepted by SignPath Foundation. Windows v0.0.439 installers are unsigned; the proposed process below is not active signing infrastructure.

## Project and release identity

[xopc](https://github.com/xopcai/xopc) is an MIT-licensed personal AI assistant. It can use a local Gateway or a server selected by the user, and can invoke tools within the configured permissions. Desktop automation, command execution, file access, microphone access, and optional network integrations are security-sensitive capabilities, not hidden background functionality.

Download official installers from [xopc.ai](https://xopc.ai/en#download) or [GitHub Releases](https://github.com/xopcai/xopc/releases). Match each download to its version and architecture. Existing macOS signing is independent of the proposed Windows SignPath integration.

## Proposed signing responsibilities

- Repository maintainer and current administrator: [xopcai](https://github.com/xopcai).
- Committers: maintainers explicitly granted write access by the repository owner. External contributions require maintainer review.
- Signing applicant and intended approver: xopcai, confirmed by the maintainer on 2026-11-02. The maintainer confirmed GitHub MFA is enabled; this is an owner attestation, not an API verification. SignPath account MFA and role assignment are still pending. No SignPath API credentials are configured yet.
- All people with source or signing access must use MFA. Every release submitted to the Foundation must receive human approval. A CI token alone must not approve production signing.

Repository permission changes, signer onboarding, and the final division of roles must be recorded before signing is enabled.

## Proposed artifact policy

Build on GitHub-hosted runners from a recorded repository commit and version tag. Retain the workflow artifact identity, source revision, dependency/license inventory, and checksums. Local developer builds are not signing inputs.

The Windows application launcher, project-built helpers, installer, and generated uninstaller need an explicit artifact configuration approved for this project. Product name and version restrictions must match xopc and the release. Electron/NSIS launcher and uninstaller handling must be agreed with SignPath before activation.

Upstream binaries may be distributed only under their respective licenses. Do not apply the Foundation certificate indiscriminately to third-party DLLs, Node addons, Electron components, ripgrep, Cua driver executables, or other upstream files. Preserve their licenses and existing signatures; keep them outside the project signing allowlist unless SignPath explicitly approves otherwise.

Signing changes executable bytes. Recompute update hashes, manifests, and download sizes from the final signed installer, then verify the public download. Enable production Windows auto-updates only after publisher identity and timestamp verification, tamper rejection, and an upgrade between two signed versions have been tested on Windows x64 and ARM64. Existing unsigned installations need a manually installed signed baseline.

## Desktop privacy disclosure

This section describes desktop software behavior, not the privacy practices of every website or external provider.

| Activity | Data and destination | User controls and current limitations |
| --- | --- | --- |
| Local storage | Configuration, conversation history, workspace files, and logs are kept on the Gateway host. Default local state is `~/.xopc`; a remote Gateway stores its own server-side state. | Choose the Gateway and authorized workspaces. Back up or remove data deliberately. |
| Model inference | Prompts, selected history/context, attachments, and tool results may be sent to the model provider configured by the operator. | Choose a local model for on-device inference; review provider settings and context before using a cloud model. |
| Desktop and workspaces | Authorized file, command, browser, clipboard, microphone, or screenshot operations may expose data to the selected Gateway/model and connected services. | Grant only necessary capabilities. Remote device registration and individual grants are separate from chatting. Not every operation necessarily prompts individually. |
| Desktop updates | Automatic desktop updates, when enabled, contact `https://xopc.ai/api/download` after startup and periodically, download available updates, and can install them on quit. Downloads can be served by GitHub. Service operators receive normal network request metadata such as IP address and client headers. | The next Windows build presents the complete desktop disclosure and an automatic-update checkbox before installation. Fresh installs default off; silent upgrades preserve the existing choice. Opting out prevents background desktop update checks/downloads and installation on quit; explicit manual checks may download an update. Re-run the installer to change the choice. The setting is independent of Gateway configuration. Previously published v0.0.439 installers do not contain this new page; macOS/Linux behavior is unchanged. |
| Tracing | Local tracing is enabled by default. Export to Langfuse is disabled by default and requires operator configuration. | Review tracing configuration, capture mode, retention, credentials, and the selected export destination before enabling remote export. |
| Optional services | Configured messaging channels, model APIs, connectors, remote access, voice services, web tools, and catalog/store screens may contact their respective services. | Enable only needed integrations and review the selected service's privacy terms. Downloaded extensions and skills can introduce additional behavior. |

Relevant service policies include [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) for downloads and repository interactions, and [Langfuse](https://langfuse.com/privacy) if its cloud export is configured. Model, channel, connector, and remote Gateway operators have their own policies; there is no single provider policy that covers every possible configuration. The xopc.ai website's own cookies, analytics, and server policies require a separate website review; this page does not certify them.

Do not assume that local storage means all processing stays local. Do not submit secrets or private logs to public issues. See [user understanding](./user-understanding.md), [data locations](./workspace.md), and [desktop installation/uninstallation](./desktop-app.md).

## SignPath status and attribution

Application materials are being prepared under the [Foundation conditions](https://signpath.org/terms.html). Eligibility, the signing scope, privacy controls, and maintainer identity are not yet approved.

If accepted and enabled, the published policy and relevant release pages will include the Foundation's required attribution:

> Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

This conditional attribution does not claim sponsorship or a valid SignPath signature for any current download. The final certificate Subject must be verified from a signed artifact; do not infer or preconfigure it from the Foundation's display name.

Report security concerns through [GitHub private vulnerability reporting](https://github.com/xopcai/xopc/security/advisories/new). General project questions belong in [Discussions](https://github.com/xopcai/xopc/discussions).

## Technical preparation in source

The Windows helper now receives the release product/version metadata. Builds capture observed bundle dependencies, exact staging packages, license text, third-party binary hashes and a retained runtime resolution under `resources/compliance`. The `dependency-inventory-<platform>-<arch>.json` release sidecar inventories the final application filesystem; the embedded inventory describes pre-builder inputs. Review flags are not legal approval, and opaque upstream bundles still need their upstream provenance/notices reviewed.

The signing boundary identifies the project helper separately from upstream executables/DLLs/addons. Electron launcher and generated NSIS installer/uninstaller signing still require explicit Foundation approval. Requesting `XOPC_WINDOWS_SIGNING_PROVIDER=signpath` fails closed before packaging; no token, guessed publisher name or PFX fallback activates Foundation signing.

Windows readiness checks are run by `.github/workflows/windows-signpath-readiness.yml`: real native privacy page, fresh/silent-upgrade consent, helper metadata, installed dependency reports, local Gateway startup with background updates off, explicit manual update checks and uninstallation. This preparation is not a signed Windows release or a two-signed-version update acceptance.
