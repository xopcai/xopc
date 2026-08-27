# Public tunnel safety

A public tunnel gives your local Gateway an internet-accessible URL. Use it only when a private network, Tailscale, or SSH cannot meet the requirement.

## Before starting

1. Back up xopc state.
2. Generate a strong Gateway token.
3. Run `xopc doctor --security`.
4. Review every Agent, tool, channel, connector, and extension reachable through the Gateway.
5. Read and accept the risk notice in **Settings → Remote access**.

## Main risks

- Anyone who obtains the public URL and token may reach your Gateway.
- Traffic passes through tunnel infrastructure outside the local host.
- Public exposure increases automated scanning and credential-guessing attempts.
- A broad Agent permission can turn a stolen token into file, account, or messaging access.

## Safer operation

- Keep the tunnel off when it is not needed.
- Avoid automatic startup unless continuous public access is intentional.
- Never put the URL, token, registration secret, or pairing QR in a public screenshot.
- Use pairing or allowlists on message channels.
- Review logs and rotate credentials after any suspected disclosure.
- Stop and release the public address when the integration is retired.

Use `xopc tunnel --help` for the installed version's start, status, stop, and release commands. Confirm the Gateway still requires authentication after the tunnel starts.

For most personal access, follow [Tailscale](./gateway/tailscale.md) instead.
