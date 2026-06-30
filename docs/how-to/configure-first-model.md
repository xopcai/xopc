# How to configure your first model

Use this when xopc is installed but the agent cannot call a model yet.

## 1. Save a provider key

Use `providers set-key` for API-key providers:

```bash
xopc providers set-key deepseek
```

The command prompts for the key without echoing it. You can also pass a key explicitly when scripting:

```bash
xopc providers set-key deepseek --key "$DEEPSEEK_API_KEY"
```

Check credential status:

```bash
xopc providers list
```

## 2. Pick a model

List models:

```bash
xopc models list --provider deepseek
```

Set the default model:

```bash
xopc models set deepseek/deepseek-chat
```

Check the result:

```bash
xopc models status
```

## 3. Try a local chat

```bash
xopc tui --local
```

If the model call fails, run:

```bash
xopc doctor
xopc logs tail
```

## Notes

- `xopc onboard --quick` is the guided path for the same setup.
- OAuth-capable providers can also be managed through `xopc models auth login --provider <id>`.
- The configuration file remains `~/.xopc/xopc.json`; credentials may be stored through auth profiles rather than as raw keys in the JSON file.
