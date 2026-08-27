# Weixin (WeChat)

Connect Weixin by scanning a login QR code from the Gateway console. The login credentials are stored on the Gateway host, so perform setup on the xopc instance that will stay running.

## Connect

1. Open **Channels → Weixin**.
2. Choose **Login** or **Configure**.
3. Scan the QR code with the intended Weixin account.
4. Confirm the login in Weixin if prompted.
5. Keep the direct-message policy set to **Pairing**.
6. Save optional account and streaming settings.

After login, send a test message and approve the pairing request in xopc.

## Access policy

Pairing is recommended because an unknown sender must present a one-time code before messages reach the Agent. You can also approve on the Gateway host:

```bash
xopc channels pairing approve weixin <code> --account default
```

Use **Allowlist** for fixed users, **Open** only for an intentionally public assistant, and **Disabled** to block direct messages.

## Multiple accounts

Add account-specific settings only when you need separate Weixin identities or routing. Complete and verify one account first; use clear account names so pairing and logs are easy to interpret.

## Troubleshooting

- QR code expired: close the dialog and start a new login.
- Login succeeds but messages do not arrive: confirm the same Gateway holds the saved credentials and remains running.
- Unknown user gets no code: check that direct-message policy is Pairing rather than Allowlist.
- Reply fails: verify local Chat and inspect the Weixin channel logs.

Do not copy the stored login files to an untrusted machine. Re-login if credentials are revoked or moved to a new Gateway host.
