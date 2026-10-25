# Access through an SSH tunnel

An SSH tunnel securely forwards the remote host's local Gateway port to your computer. It is the universal fallback when you already have SSH access to the host.

## Prepare a VPS host

On a persistent VPS, including Hetzner:

1. Install Node.js >= 26.12.1 and xopc using the [installation guide](../getting-started.md).
2. Set `gateway.bind` to `loopback` and configure a strong Gateway token.
3. Install and start the Gateway service:

   ```bash
   xopc gateway service install
   xopc gateway service start
   ```

4. Allow SSH access (normally port 22) or Tailscale in the host firewall. Keep Gateway port `18790` private.
5. Open the SSH tunnel below, or configure [Tailscale Serve](./tailscale.md) with `gateway.tailscale.mode=serve`.

If public access is required, review [public tunnel safety](../tunnel-security.md) and accept the tunnel risk notice before enabling it. See [network access](../network.md) for the available access layers.

## Open the tunnel

Run on your local computer:

```bash
ssh -N -L 18790:127.0.0.1:18790 user@gateway-host
```

Or use:

```bash
xopc gateway ssh-tunnel --target user@gateway-host
```

Keep that terminal running, open `http://127.0.0.1:18790` locally, and use the remote Gateway's token.

## Safety

- Keep the remote Gateway bound to loopback.
- Use SSH keys and protect the private key.
- Do not also expose the remote Gateway port for convenience.
- Close the tunnel and remove saved tokens on a shared computer.

## Troubleshooting

- SSH fails: verify `ssh user@gateway-host` by itself first.
- Local port is occupied: use another local port, for example `18791:127.0.0.1:18790`.
- Unauthorized: use the remote Gateway's token, not a local instance's token.
- Page does not load: run `xopc gateway health` on the remote host.

See [Remote access](../remote-access.md) for other methods.
