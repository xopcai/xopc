# Chrome extension

The xopc Chrome extension adds a compact Chat experience to the browser and can, when you explicitly allow it, share or control the current page. It uses the same persistent Sessions as the desktop and web console, so a conversation can continue across surfaces.

The extension requires a running xopc Gateway. It does not call a model directly when the Gateway is offline.

## What is included

- Persistent conversations, recent Session selection, streaming responses, stop, retry, and recovery after the side panel is closed and reopened.
- Markdown, code blocks, links, copy actions, tool activity, errors, and the essential approval states needed to complete a turn.
- Files, screenshots, PDFs, the current page, selected text, and explicit tab mentions as conversation context.
- Browser control through the authenticated Gateway Realtime connection.
- Light and dark themes aligned with the Gateway console.

The side panel intentionally contains fewer management features than the full Gateway console. Configure Agents, models, tools, remote access, and advanced browser policy in the desktop or web console.

## Install from the desktop or web console

1. Start the Gateway.
2. Open **Settings → Browser**.
3. Enable browser control and select **Chrome extension**.
4. Select **Install extension files**. xopc prepares a stable extension directory and the local discovery host.
5. Select **Open extensions**, enable **Developer mode**, and choose **Load unpacked**.
6. Select the directory shown by xopc. The default command-line installation is `~/.xopc/bin/browser-ext`; select this directory itself, not its `dist` subdirectory.
7. Pin xopc if desired, then select its toolbar icon to open the side panel.

Chrome does not permit ordinary applications to silently install an unpacked extension. The one-time **Load unpacked** action is therefore required outside Chrome Web Store or enterprise-policy distribution. Electron and Gateway startup can prepare and repair the files, but cannot bypass this browser boundary.

## Install from the command line

```bash
xopc browser extension install
xopc browser extension doctor
xopc browser doctor
```

The install command prints the exact `extensionDir`. Load that directory from `chrome://extensions`. A healthy result has:

- `installed: true`;
- a valid `extensionDir`;
- `nativeHost.installed: true` on supported local systems;
- no `needsRefresh` or `needsChromeReload` indication.

Automatic local discovery is currently installed for Chrome, Chrome for Testing, Chromium, Microsoft Edge, and Brave on macOS and Linux. Windows can use the extension and its normal pairing flow, but local Native Messaging auto-discovery is not currently installed automatically.

## Development checkout

Build before copying the extension so the installed directory never receives stale or incomplete assets:

```bash
pnpm install
pnpm -C packages/browser-ext run build
pnpm run dev -- browser extension install
pnpm run dev -- gateway
```

Then load the `extensionDir` reported by the install command. After changing extension code:

```bash
pnpm -C packages/browser-ext run build
pnpm run dev -- browser extension install
```

Open `chrome://extensions`, find xopc, and select **Reload**. Refresh any page that was already open before testing page capture or control.

`pnpm run pack:browser-ext` creates a distributable archive and also builds the extension, but it is not required for the normal development loop. `pnpm run sync:browser-ext-version` is part of the release flow; it is not a substitute for rebuilding or reloading the extension.

## Local automatic connection

On a supported local installation, opening the side panel normally connects without a pairing code or Gateway approval:

1. Gateway startup installs or repairs the fixed extension directory and the `ai.xopc.browser` Native Messaging manifest.
2. The extension generates a non-exportable P-256 device key.
3. The native host discovers only the local loopback Gateway and requests a short-lived, one-time enrollment bound to the fixed extension ID and key fingerprint.
4. The extension verifies the Gateway signature, stores a scope-limited device credential, and opens an authenticated Realtime connection.

Native Messaging is used only for local discovery and enrollment. It does not carry chat messages, page contents, owner tokens, or long-lived credentials, and it does not remain running as a proxy.

Selecting **Disconnect** revokes the browser device, clears its credentials, key, pending outbox data, and disables automatic reconnection. Select **Connect local Gateway** to opt in again.

## Remote or self-hosted Gateway

A Gateway running on another computer or server does not receive local auto-approval. This is intentional: a website, remote server, or forged localhost response must not be able to enroll a browser silently.

1. Expose the Gateway through a protected route such as Tailscale or HTTPS. See [Remote access](./remote-access.md).
2. Generate a fresh browser pairing link from the Gateway owner interface.
3. Paste the link into the extension.
4. Compare the confirmation code and approve the request in the Gateway.

The extension requests access only to the selected Gateway origin. Keep the browser online while using the extension driver. For unattended server automation, prefer Playwright or a configured remote browser instead of depending on a user's Chrome session.

## Page and site permissions

Installing the extension does not give xopc permanent access to every page.

| Action | Permission behavior |
| --- | --- |
| Chat without page context | Does not read the current page |
| Attach current page or selection | Requests access to that page's origin when needed |
| Mention another tab | Requests access to the selected tab's origin when needed |
| Attach/control the current tab | Creates an explicit Session-to-tab binding and applies Gateway browser policy |
| High-impact action | Still follows configured approval policy even when site access is granted |

The manifest contains optional HTTP/HTTPS host permissions so Chrome can grant one origin at a time. You do not need to select **On all sites** for normal use. Chrome internal pages, the Chrome Web Store, extension pages, and other restricted schemes cannot be read or controlled.

Page text is captured only after an explicit action. Password fields, one-time codes, payment fields, forms, scripts, hidden content, and embedded frames are excluded from the basic page snapshot. Captured page content is treated as untrusted input and cannot grant itself additional permissions.

## Updates

xopc keeps the unpacked extension at a fixed path. A Gateway or desktop update can replace the files in that directory without requiring **Load unpacked** again.

Chrome does not automatically reload an unpacked extension after its files change. If **Settings → Browser** reports a version mismatch or **Reload extension**:

1. Open `chrome://extensions`.
2. Find xopc and select **Reload**.
3. Refresh tabs that xopc should read or control.
4. Return to **Settings → Browser** and run the connection test.

The extension manifest version is synchronized with the core xopc version during `release:patch`, and the production build verifies that the side panel, background service worker, manifest, and required assets are present.

## Troubleshooting

### The side panel is blank

1. Run `xopc browser extension doctor` and verify `installed: true`.
2. Confirm that Chrome loaded the directory containing `manifest.json`, not `dist/`.
3. Reinstall the files, reload the extension, and reopen the side panel:

   ```bash
   xopc browser extension install
   ```

4. In development, build the extension before running the install command.
5. Inspect the extension service worker from `chrome://extensions` for an initialization error.

### The extension says it is waiting for approval

- A same-machine macOS/Linux installation should normally auto-enroll. Run `xopc browser extension doctor` and repair the native host with `xopc browser extension install`.
- Make sure the running Gateway and the install command use the same xopc profile, state directory, and config path.
- Remote and server Gateways always require the owner to approve the pairing request.
- If **Disconnect** was selected previously, automatic enrollment remains disabled until **Connect local Gateway** is selected.

### Chrome reports “Extension manifest must request permission to access this host”

Current releases declare HTTP/HTTPS as optional host permissions and request the exact origin during an explicit page action. If this message appears:

1. Update xopc and reinstall the extension files.
2. Reload xopc from `chrome://extensions`; an older loaded service worker may still be running the previous manifest.
3. Open the extension's **Details → Site access** and make sure access is not blocked for the site. Prefer **On click** or the specific site instead of all sites.
4. Refresh the target page and try **Attach page** again.
5. Confirm the page is a normal `http://` or `https://` page, not a Chrome internal or Web Store page.

If a newly requested permission is denied or a capture fails immediately after granting it, xopc removes that newly granted origin and asks again on the next explicit attempt.

### The assistant reports `DRIVER_UNAVAILABLE`

```bash
xopc browser extension doctor
xopc browser doctor
```

Then open **Settings → Browser** and run the connection test. Check, in order:

1. Browser control is enabled and the selected driver is **Chrome extension**.
2. Extension files and the native host are current.
3. The xopc side panel has been opened and shows the expected Gateway.
4. Chrome and the Gateway report the same extension protocol/version; reload Chrome when requested.
5. The target site permission has been granted if the operation reads or controls a page.

xopc `v0.0.268` fixed a case where an unbound browser action added `target: undefined`, failed strict argument serialization, and was misleadingly reported as `DRIVER_UNAVAILABLE`. If logs contain `Canonical JSON does not support undefined`, update the Gateway to `v0.0.268` or newer and restart it.

### Chat works but browser control does not

Chat and browser control share the Gateway but use different authorization checks. Verify the extension status says **Gateway Realtime**, the browser endpoint is connected, and the current Session is explicitly attached to the intended tab. Granting site access alone does not attach a Session or approve consequential actions.

## Security summary

- The extension UI and scripts are packaged locally; the Gateway does not provide remote executable code.
- Gateway access uses a scope-limited browser device credential; Realtime browser control also requires a signed endpoint identity and short-lived turn token.
- Local auto-enrollment is limited to a fixed extension ID, loopback Gateway, native issuer, key fingerprint, nonce, and short lifetime.
- Remote/self-hosted enrollment requires an explicit pairing link and owner approval.
- Page access is optional and origin-scoped; page content is untrusted data.
- Current-tab control requires a Session binding and remains subject to URL, risk, upload, and approval policy.

For reusable browser tasks, continue with [Browser automations](./browser-automations.md). The implementation and threat model are recorded in the repository's [Chrome extension Side Panel design](https://github.com/xopcai/xopc/blob/main/docs/design/chrome-extension-side-panel-chat.md).
