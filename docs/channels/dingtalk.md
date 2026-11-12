# DingTalk

In **Settings → Channels → DingTalk**, choose **Set up by QR**. Scan with the DingTalk mobile app and approve creation of a bot. If your organization requires administrator approval, finish it in DingTalk.

For an existing bot, enable **Stream** message reception in the DingTalk developer console, grant the bot permission to send direct and group messages, and publish it. Choose **Enter credentials** in xopc and enter its Client ID and Client Secret. The gateway opens an outbound WebSocket, so it can run behind NAT.

Send the bot a direct message and approve the pairing request in xopc. To use the bot in a group, add it to the group, add the permitted member's DingTalk sender ID to **Allowed group senders**, then mention the bot. The channel supports text in direct chats and group mentions.

The gateway reconnects after a connection drop and reopens the connection after restart. Keep the gateway running while the channel is enabled.

[Official DingTalk OpenClaw plugin](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/tree/88df00ee594072e9941ef3f71da90a37f3291ad3) · [DingTalk Stream SDK](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs)
