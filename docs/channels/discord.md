# Discord

1. In **Settings → Channels → Discord**, select **Configure Discord** and open the Discord Developer Portal.
2. Create an application and copy its **Bot Token** from the **Bot** page. Paste the token into xopc and save.
3. Use **Invite bot to a server** to add it to a server where you have permission to install apps.

Send the bot a direct message and approve its pairing request in xopc. In a server, allow the relevant members under **Allowed channel senders** and mention the bot. Replies stay in the channel or existing thread that received the mention. For server threads, the bot needs access to the thread and permission to send messages there.

The Gateway uses the standard guild-message and direct-message intents. Direct messages and explicit mentions can be read without enabling the privileged Message Content intent. The gateway resumes the Discord session after transient disconnects when Discord permits it. On a gateway restart, it reconnects with the saved token and restores pending xopc messages.

[Discord Gateway](https://docs.discord.com/developers/events/gateway) · [OpenClaw Discord source](https://github.com/openclaw/openclaw/tree/b029a471858e63304a3c6e6e1b6d698fbf2fdc65/extensions/discord)
