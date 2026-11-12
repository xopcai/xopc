# Slack

In **Settings → Channels → Slack**, select **Configure Slack** and copy the **App Manifest**. Open Slack's app settings, choose **Create New App → From an app manifest**, select your workspace, paste the JSON, then install the app to that workspace. Your Slack administrator may need to approve the installation.

1. Copy the **Bot User OAuth Token** (`xoxb-`) from **OAuth & Permissions**.
2. In **Basic Information → App-Level Tokens**, generate an **App Token** (`xapp-`) with `connections:write`.
3. Enter both tokens from the same Slack app in xopc and save. The Gateway opens an outbound Socket Mode connection.

Send the bot a private message and approve its pairing request in xopc. For a channel, invite the bot, add the Slack member IDs who may invoke it to **Allowed channel senders**, then mention the bot. The bot starts a thread under a top-level channel mention and replies in the original thread when mentioned there. Private messages in an existing thread stay in that thread.

Run one active xopc gateway per Slack app. The gateway obtains a fresh connection URL when Slack requests a refresh or the connection drops. Restarting the gateway reconnects with saved credentials. Socket Mode is suitable for self-hosted Slack apps in your workspace.

[Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/) · [OpenClaw Slack plugin source](https://github.com/openclaw/openclaw/tree/24819901d92ee379b5b36a957276d3b3657d7b79/extensions/slack)
