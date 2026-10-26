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

### Recovering an active lease without its local token

OAuth authorization creates a registration key; it does not replace an existing
lease's tunnel token. An active instance extends its lease on every heartbeat,
so waiting for expiry does not work while that instance remains connected.

When ordinary registration reports `TUNNEL_RECOVERY_PROOF_REJECTED`, choose
**Recover connection** in device pairing or remote-access settings. The Gateway
sends an explicit recovery request to `POST /api/tunnels/recover`, signed by its
original Ed25519 identity with that endpoint as the signature audience. The Broker
requires a valid registration key and the same reserved Gateway id, public key,
user, workspace, and principal. It replaces the lease atomically, preserving the
public hostname and invalidating the previous tunnel and FRP tokens. This action
intentionally disconnects any other instance using that Gateway identity.
Ordinary registration still requires the current tunnel token to replace a live
lease; it never performs automatic takeover.

Deploy the updated platform Broker before the updated Gateway/UI. A Broker that
does not support recovery returns an explicit update-required error. If the
original Gateway identity or its owning account is unavailable, this recovery
path cannot take over its reservation; administrator assistance is required.
Do not delete `xopc.db` or `tunnel.json` to fix this error. A failed cloud release
retains local recovery credentials and reports failure instead of claiming the
lease was released.
