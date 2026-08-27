# Troubleshoot xopc

Start with the failing surface, run the matching checks, and share only a redacted report if you need help.

## Run the general check

```bash
xopc doctor
```

Use `xopc doctor --deep` only when Session or database state may be involved. Use `xopc doctor --security` when diagnosing remote access or exposure settings.

## The model does not reply

```bash
xopc providers list
xopc models status
xopc agent -m "Reply with OK"
```

Common causes are an expired key, the wrong model name, insufficient provider quota, or blocked network access. Reconfigure the credential with `xopc providers set-key <provider>`.

## The desktop or web console does not open

```bash
xopc gateway status
xopc gateway health
```

If the Gateway is stopped, run `xopc gateway`. If the port is already occupied, stop the other process or change `gateway.port`. Do not expose the Gateway publicly just to work around a local connection problem.

## A channel does not reply

1. Confirm that local Chat can reach the model.
2. Run `xopc channels list` and `xopc channels show <channel>`.
3. Check the bot/app credential and the direct-message or group policy.
4. Confirm that the Gateway is running continuously.
5. Read the channel-specific guide under [Channels](../channels/index.md).

## Validate configuration

```bash
xopc config path
xopc config validate
xopc config show
```

`config show` masks recognized secrets. A validation error normally includes the field that must be corrected.

## Read recent logs

<!-- Screenshot placeholder: /screenshots/logs-filter.png -->

```bash
xopc logs tail
xopc logs query --limit 50
xopc logs stats
```

In the desktop or web console, open **Settings → Logs**, filter by the time of the failure, and inspect the first error in the request rather than later follow-on errors.

## Prepare a safe support report

Include:

- operating system and xopc version;
- the exact failing action or command;
- `xopc doctor --json` output;
- the smallest relevant set of log lines;
- whether the same model works in local Chat.

Remove API keys, OAuth tokens, Gateway tokens, bot tokens, user identifiers, private messages, and personal filesystem paths before sharing anything.
