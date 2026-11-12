# WeCom

In **Settings → Channels → WeCom**, choose **Set up by QR**. Scan with the WeCom mobile app and complete bot creation for your organization. Availability of the QR flow depends on the WeCom admin console.

For an existing bot or when scan-to-create is unavailable, create a Smart Robot in **API Mode** in WeCom, select the long-connection option, and copy the Bot ID and Secret. Choose **Enter credentials** in xopc. The gateway opens an outbound WebSocket and shows the connection status in Channels.

Send the bot a direct message and approve the pairing request in xopc. To use the bot in a group, add it to the group, add the permitted member's WeCom sender ID to **Allowed group senders**, then mention the bot. Group replies use the mention's reply context. A fresh mention is required if that context has expired.

The gateway reconnects after network interruptions and restores the connection after restart. Use one running gateway per Bot ID. If another gateway takes over the bot, stop that gateway and toggle the channel to reconnect.

[Official WeCom OpenClaw plugin](https://github.com/WecomTeam/wecom-openclaw-plugin/tree/2b8c84e696ec98c967ff95030270c6acb5c4b51d) · [WeCom WebSocket SDK](https://github.com/WecomTeam/aibot-node-sdk) · [QR setup reference](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/wecom/)
