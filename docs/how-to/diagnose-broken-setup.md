# How to diagnose a broken setup

Use this when xopc installed but a chat, gateway, model, or channel does not work.

## 1. Run doctor

```bash
xopc doctor
```

Use deeper checks when session or database state may be involved:

```bash
xopc doctor --deep
```

For gateway exposure issues:

```bash
xopc doctor --security
```

## 2. Check gateway status

```bash
xopc gateway status
xopc gateway health
```

If your gateway is not on the default URL:

```bash
xopc gateway status --url http://127.0.0.1:18790 --token "$XOPC_GATEWAY_TOKEN"
```

## 3. Check model credentials

```bash
xopc providers list
xopc models status
```

If a provider is missing a key, set it:

```bash
xopc providers set-key <provider>
```

## 4. Read logs

```bash
xopc logs tail
xopc logs query --limit 50
xopc logs stats
```

## 5. Validate configuration

```bash
xopc config validate
xopc config show
```

When you share a report, include the failing command, `xopc doctor --json`, and relevant log lines. Do not share API keys, gateway tokens, or bot tokens.
