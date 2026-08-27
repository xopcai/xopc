# Access with Tailscale

Tailscale Serve lets devices in your Tailnet reach a Gateway that remains bound to the local computer. It is the recommended remote-access method for personal devices.

## Set up

1. Install and sign in to Tailscale on the Gateway host and client device.
2. Confirm both devices appear in the same Tailnet.
3. Generate a Gateway token.
4. Start:

```bash
xopc gateway --tailscale serve --tailscale-reset-on-exit
```

5. Connect with the Tailscale HTTPS address shown by the command and the Gateway token.

Check status:

```bash
xopc tailscale status
xopc gateway health
```

## Serve or Funnel?

**Serve** is limited to Tailnet devices and suits normal personal access. **Funnel** creates a public entry point and is much higher risk; do not use it unless you specifically need a public service and have configured strong authentication.

## Troubleshooting

- Confirm host and client are signed in to the intended Tailnet.
- Check Tailscale DNS, ACLs, and device status.
- Keep the Gateway on loopback and use a valid token.
- Disable another auto-starting tunnel if it conflicts with Tailscale exposure.

See [Remote access](../remote-access.md) for the complete security checklist.
