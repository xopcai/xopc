# Mobile app

Run xopc on your own computer and continue the same work from your phone. The computer owns the workspace and conversations; the phone lets you review progress and send instructions.

## Connect your work computer

1. Open xopc on the computer and choose **Connect phone** in the sidebar.
2. Follow the connection wizard if remote access is not enabled. Existing HTTPS or Tailscale connections can be reused.
3. Choose **Scan QR code** on the phone.
4. Compare the numbers on both devices and choose **Allow connection** on the computer.
5. The phone opens your work automatically.

The QR code lasts 10 minutes. Desktop approval expires 2 minutes after scanning; refresh the QR code if needed. A QR code does not replace desktop approval or contain a long-lived credential. The wizard also provides a temporary pairing link.

## Working away from your computer

Keep the computer running and connected. In the desktop app, enable **Keep running when the window closes** to return through the tray. Quitting xopc or putting the computer to sleep disconnects the phone. This preference does not guarantee connectivity with the laptop lid closed.

Choose **Test connection** in the phone's computer settings. Turn off Wi-Fi first to test the mobile connection. If network type cannot be detected, the result says only that the current connection is ready. The test checks authorized HTTP and the realtime work connection; it does not guarantee future availability.

## Connection loss and pending work

- Disconnection preserves the current screen. Pending messages retry when the connection returns.
- Pending work is isolated by computer, with attachments retained in the app's persistent directory. Uninstalling the app or clearing its data removes local content.
- Messages older than a day, reset conversations, missing attachments, or rejected requests require review. You can retry, copy the text, or remove the local queue entry.
- Legacy entries without a computer identity are available for review and copying, never automatic delivery.
- Removing an entry stops future local retries. Work already submitted may continue.

Revoke a phone from **Devices** on the computer. The phone must scan again and receive approval to reconnect. Work remains on the computer.

## Troubleshooting

| Message | Action |
| --- | --- |
| Computer unreachable | Check that the computer is awake, xopc is running, and remote access is connected |
| Update the desktop app | Update xopc, then create a new QR code |
| Confirm on your computer | Compare the numbers and allow the phone; refresh expired QR codes |
| A message needs review | Inspect the content; after a conversation reset, copy it into the intended conversation |
| Cannot verify computer identity | Generate a new code on the intended computer; do not bypass certificate checks |

See [Remote access](./remote-access.md) for advanced configuration.
