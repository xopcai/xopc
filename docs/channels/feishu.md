# Feishu (Lark)

Connect a Feishu or Lark bot through the guided QR setup, or configure an internal app manually. Socket Mode is the simplest option because it does not require a public webhook endpoint.

## Guided setup

1. Ensure the optional Feishu SDK is available. For a global xopc installation, run `npm install -g @larksuiteoapi/node-sdk@1.66.0`.
2. Open **Channels → Feishu**.
3. Choose **Configure**.
4. Select **Feishu (China)** or **Lark (international)**.
5. Scan the QR code and complete the platform prompts.
6. Keep connection mode set to **WebSocket / Socket Mode**.
7. Keep direct messages on **Pairing**, then save.
8. Send the bot a test message and approve the pairing request.

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
