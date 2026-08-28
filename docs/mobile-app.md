# Mobile app

The mobile app connects to a Gateway that continues running on your computer or server. It is useful for chatting, capturing notes, and checking ongoing work away from the host machine.

## Before connecting

1. Confirm the Gateway and local Chat work.
2. Choose a protected remote-access method, preferably Tailscale.
3. Generate or retrieve the Gateway token.
4. Keep the host awake and the Gateway service running.

## Connect

<!-- Screenshot placeholder: /screenshots/mobile-connect.png -->

1. Open **Settings → Remote access** in the desktop or web console.
2. Prepare the protected Gateway URL and token, or use the available pairing flow.
3. In the mobile app, add the Gateway.
4. Verify the health/status screen.
5. Open a known Session before starting a new chat.

The app should show the same Agents and Sessions as the host. If it does not, it is probably connected to another Gateway or profile.

## Security

- Do not use an unencrypted public HTTP URL.
- Do not send the Gateway token through chat or email.
- Use device lock and revoke access if the phone is lost.
- Prefer private networking over a public tunnel.
- Rotate the token after accidental disclosure.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Cannot reach Gateway | Host is online, service is running, and private network/tunnel is connected |
| Unauthorized | URL and token belong to the same Gateway |
| Sessions are different | The mobile app is connected to the intended host and profile |
| Messages stay pending | Model works on the host and the realtime connection is not blocked |

Follow [Remote access](./remote-access.md) for network diagnosis.
