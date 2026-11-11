# Feishu (Lark)

Connect a Feishu or Lark bot through the guided QR setup, or configure an internal app manually. Socket Mode is the simplest option because it does not require a public webhook endpoint.

## Guided setup

1. Open **Channels → Feishu**, select **Feishu** or **Lark**, and click **Connect**.
2. On first use, the Gateway installs the Feishu component on demand. Scan the QR code and confirm in Feishu or Lark.
3. Send the code displayed in the console in a private chat with the bot. The console confirms two-way delivery after the bot replies.

A new QR-configured account restricts direct messages to the scanner. When the platform does not return the scanner's identity, normal chats require pairing. Complete any required app publication or administrator approval before sending the verification message.

## Manual app setup

In the Feishu Open Platform or Lark Developer console:

1. Create an internal app and add the **Bot** capability.
2. Copy its App ID and App Secret into xopc.
3. Enable Socket Mode / persistent connection.
4. Subscribe to inbound message events.
5. Add only the API scopes required by the features you will use.
6. Publish or ask an administrator to approve the app when your tenant requires it.

Start with chat and basic identity permissions. Add document, Wiki, Drive, permission, or Bitable scopes only when the Agent needs those tools.

## Pairing and groups

Pairing is recommended for direct messages. Approve a code in the console or run:

```bash
xopc channels pairing approve feishu <code> --account default
```

For groups, restrict allowed chats and require a mention when supported. A bot with document or Drive tools can access more than chat content, so keep its Agent and app scopes narrow.

## Webhook mode

Use Webhook mode only when your deployment already provides a secure HTTPS endpoint. It requires the Verification Token and Encrypt Key from the platform, plus a correctly routed event URL. Prefer Socket Mode for a personal or local installation.

## Troubleshooting

- QR setup fails: select the correct Feishu/Lark region and retry with an authorized tenant account.
- App connects but sees no messages: verify the bot capability, event subscription, app publication, and tenant approval.
- A document tool is denied: add the exact required scope, then obtain approval again.
- Webhook validation fails: check the public URL, Verification Token, Encrypt Key, and TLS configuration.
