# Demo Provider extension

Bundled mock LLM provider for validating the extension provider pipeline (`registerProviderPlugin`, model resolution, gateway model list, and `streamFn` bridge).

## Models

| Model ref | Description |
|-----------|-------------|
| `demo/demo-chat-7b` | Mock chat model (streaming text only) |

## Try it

```bash
pnpm run dev -- agent --model demo/demo-chat-7b -m "Hello demo!"
```

You should see logs from `ExtensionStreamBridge` and an assistant reply mentioning **demo-chat-7b** and the Demo Provider extension.

## Configuration (optional)

In `~/.xopc/xopc.json`:

```json
{
  "extensions": {
    "demo-provider": {
      "enabled": true,
      "baseUrl": "https://api.example.com/v1",
      "apiKey": ""
    }
  }
}
```

The mock stream does not call `baseUrl`; those fields are placeholders for copying this extension toward a real HTTP backend.

## Documentation

See [.docs/extension-provider-demo.md](../../.docs/extension-provider-demo.md) in the repo root.
