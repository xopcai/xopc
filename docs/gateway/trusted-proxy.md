# Trusted identity proxy

Use trusted-proxy authentication only when an existing OAuth-aware reverse proxy already handles TLS and user sign-in. This is an advanced administrator setup.

The deployment must ensure that:

- the Gateway trusts only explicitly listed proxy addresses;
- the public network cannot bypass the proxy and reach the Gateway port;
- the proxy removes client-supplied identity headers before writing a verified identity;
- HTTPS, session security, and logout are handled correctly;
- API and non-browser clients have an explicit authentication path.

Back up configuration and test forged headers, direct-port access, and signed-out requests in an isolated environment. For personal devices, use Tailscale or SSH instead of adding a trusted proxy.

See [Remote access](../remote-access.md) for the decision guide.
