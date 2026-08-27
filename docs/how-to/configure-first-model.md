# Configure your first model

Connect one model provider and verify a real reply before enabling any other xopc feature.

## Choose a provider

Use a cloud provider when you want a managed model and already have an account or API key. Use Ollama or another local server when you want requests to stay on your own machine and can run the model yourself.

See [Models and providers](../models.md) for supported authentication methods and local server guidance.

## Using the desktop or web console

<!-- Screenshot placeholder: /screenshots/model-setup.png -->

1. Open the model setup prompt, or go to **Settings → Capabilities → Models**.
2. Choose a provider.
3. Sign in with OAuth or enter the requested API key.
4. Select the default model.
5. Save, then open **Chat** and send a test message.

The provider is ready when Chat returns a normal reply and the model page shows the provider as configured.

## Using the terminal

The guided option is:

```bash
xopc onboard --quick
```

To configure it manually, save a credential and select a model:

```bash
xopc providers set-key <provider>
xopc models list --provider <provider>
xopc models set <provider>/<model>
xopc models status
```

For a provider with browser sign-in:

```bash
xopc models auth login --provider <provider>
```

The key prompt hides what you type. Avoid `--key` on shared computers because command history and process tools may expose its value.

## Verify

```bash
xopc agent -m "Reply with 'xopc is ready' and identify your model."
```

If it fails, check in this order:

1. `xopc providers list` shows the provider as configured.
2. `xopc models status` shows the intended default model.
3. The account can use that model and has available quota or balance.
4. Your network can reach the provider.
5. `xopc logs tail` contains no authentication or model-not-found error.

Credentials may be stored in an auth profile rather than directly in `xopc.json`. Use xopc commands or the UI to update them instead of copying secret values into the configuration file.
