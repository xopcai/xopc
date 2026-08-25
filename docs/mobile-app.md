# Mobile app

For the verified Android/iOS signing, GitHub Actions, artifact, and TestFlight procedures, see the [mobile build and release runbook](./mobile-build-release.md).

Use the **[xopc mobile app](https://github.com/xopcai/xopc/tree/main/apps/mobile-expo)** when you want to continue the same xopc assistant from iOS or Android.

The mobile app is an Expo / React Native client for the xopc gateway, now maintained in this repository under `apps/mobile-expo`. It does not replace the gateway or create a separate hosted account: it connects to a running gateway over LAN, FRP, Tailscale, or your own HTTPS reverse proxy, then uses the same gateway Bearer token / pairing flow.

Think of it as a private remote control for your own agent. xopc keeps running on your computer or self-managed host, while the phone gives you a quick way to chat, capture notes, record ideas, and send project updates when you are away from the keyboard. Your long-term context stays in your xopc runtime.

## Quick path

1. Start your gateway:

```bash
xopc gateway
```

2. Pick how the phone reaches the gateway:

| Situation | Recommended route |
| --- | --- |
| Phone and gateway on the same Wi-Fi | LAN gateway URL |
| Away from home, need a temporary public URL | FRP public tunnel |
| You own a domain and TLS cert | Reverse proxy |
| All devices are on Tailscale | Tailscale Serve |

3. Open **Gateway console → Settings → Remote access**.
4. Use **Mobile app pairing** to scan the QR or copy the pairing link.
5. Open the mobile app and confirm the gateway base URL / token in app settings.

## Gateway access options

### LAN

Use LAN when the phone and gateway host are on the same Wi-Fi.

- Gateway may need to bind to a LAN IP or `0.0.0.0`.
- Use token auth and your local firewall.
- Android standalone builds need HTTP cleartext enabled; the mobile app enables this in its native build config.
- iOS standalone builds need local network permission; approve the iOS system prompt for xopc.

### FRP public tunnel

Use the public tunnel when you need a temporary HTTPS URL from outside your LAN or tailnet.

- Open **Remote access → Public internet**.
- Start the tunnel and wait for the public URL.
- Scan the **Mobile app pairing** QR.
- Stop the tunnel when you no longer need remote access.

Treat public tunnel exposure as high risk. Anyone with the URL or pairing QR may reach the gateway if they also obtain your Bearer token.

### Reverse proxy

Use this when you already have your own HTTPS domain, such as `https://gateway.example.com`.

- The reverse proxy terminates TLS and forwards to the loopback gateway.
- The gateway still authenticates clients with its Bearer token.
- Mobile clients require a system-trusted TLS certificate; self-signed certificates are not supported for the app path.
- The proxy must forward the `/api/realtime/v1/ws` WebSocket upgrade on every hop. Use the nginx template and verification command in [Remote access](./remote-access.md#reverse-proxy).

## Building the mobile app

The mobile app lives in this repository under `apps/mobile-expo`:

```bash
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install
pnpm run dev:mobile
```

Useful commands from the repository root:

| Command | Purpose |
| --- | --- |
| `pnpm run dev:mobile` | Expo dev server |
| `pnpm run android:mobile` / `pnpm run ios:mobile` | Development builds |
| `pnpm -C apps/mobile-expo run android:release` | Android release APK |
| `pnpm run mobile:typecheck` | TypeScript check |
| `pnpm run mobile:test:stream` | Agent stream client tests |

`react-native-mmkv` uses native code. Expo Go can run the app with in-memory fallback storage, but persistent settings require a development or standalone build.

## More detail

- [Mobile app source](https://github.com/xopcai/xopc/tree/main/apps/mobile-expo)
- [Remote access](./remote-access.md)
- [FRP tunnel security](./tunnel-security.md)
