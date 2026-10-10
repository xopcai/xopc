# Models and providers

xopc can use cloud APIs, OAuth-based providers, local model servers, and custom OpenAI-compatible endpoints. Configure at least one provider and choose a default model before starting Chat.

## See what this installation supports

The model catalog changes as providers and extensions evolve. Use the live catalog instead of relying on a static list:

```bash
xopc providers list
xopc models list
xopc models status
```

In the desktop or web console, open **Settings → Capabilities → Models**.

## Choose a model

Consider four factors:

| Factor | Question |
| --- | --- |
| Quality | Can it reliably complete your main tasks? |
| Speed | Is the response time suitable for interactive use? |
| Cost | Are pricing and usage limits acceptable? |
| Privacy | Where are prompts, files, images, and audio processed? |

Start with one general-purpose model. Add specialized or lower-cost models only after the basic setup works.

## Connect a cloud provider

Use the model settings page, or run:

```bash
xopc providers set-key <provider>
xopc models list --provider <provider>
xopc models set <provider>/<model>
xopc models status
```

For providers that support browser sign-in:

```bash
xopc models auth login --provider <provider>
```

Keep provider keys out of `xopc.json` when the credential store, auth profile, or environment variable can be used instead.

## pi 1.1 provider changes

Use `openai` for both API keys and **Sign in with ChatGPT**. Subscription users must sign in again with `xopc models auth login --provider openai`; old `openai-codex` credentials are not reused. A stored API key profile takes precedence over OAuth; remove that profile when choosing subscription access. An environment key is used when no stored profile or OAuth credential exists.

Use `azure` as the Azure provider ID. The `azure-openai-responses` API protocol and `AZURE_OPENAI_*` environment variables remain valid. Update Agent defaults, model intents, Workflows and session overrides that reference the old provider ID. Removed provider identities fail explicitly and do not select another model.

Model IDs come from the current catalog. The local `gpt-5.6` alias has been removed; select an actual listed ID, such as `openai/gpt-6-sol`. Historical conversations remain stored. Codemode and pi's built-in MCP extensions are not enabled by this dependency upgrade.

## Use a local model

1. Install and start a supported server such as Ollama, LM Studio, or vLLM.
2. Confirm its API is reachable from the machine or container running xopc.
3. Add the provider or compatible endpoint in Model settings.
4. Select a model that is actually downloaded and served.
5. Send a small Chat request.

When xopc runs in Docker, `127.0.0.1` points to the container, not the host. Use the host address supported by your Docker installation.

Local execution improves control over request handling, but model files, hardware requirements, and runtime logs remain your responsibility.

## Default model and model intents

The global chat model is used when an Agent does not specify another model. Set it with:

```bash
xopc models set <provider>/<model>
```

Advanced Agents and Workflows can use six fixed intents: `fast`, `reasoning`, `coding`, `review`, `vision`, and `understanding`. Configure them globally, then override only an Agent that genuinely needs a different route.

## Verify and troubleshoot

```bash
xopc models status
xopc agent -m "Reply with OK and identify the current model."
```

| Error | Likely cause |
| --- | --- |
| Authentication failed | Invalid, expired, or wrong provider credential |
| Model not found | Incorrect model ID or account cannot access it |
| Rate limit or quota | Provider plan, balance, or request frequency |
| Connection refused | Local server is stopped or endpoint is wrong |
| Works in terminal but not Gateway | Different environment, profile, or service credentials |

Use `xopc logs tail` to find the provider's first error. Do not post full request bodies or credentials in a support report.

## XOPC Cloud public services

After signing in to XOPC Cloud, choose `xopc-cloud/auto` for ordinary chat or `xopc-cloud/advanced` for the advanced tier. Images, recognition, synthesis and realtime voice use the public `image`, `stt`, `tts` and `realtime` entries. Computer Use has its own `xopc-cloud/computer` entry; select it in Computer Use settings, separately from chat. Availability depends on the signed-in catalog and account permissions. Codex retains its separate authorization and catalog entries.

1. Sign in through Model settings and wait for the catalog to load.
2. Select a chat service and send a test message.
3. Check Image and Voice settings separately; successful chat does not establish availability of every capability.
4. For desktop Computer Use, select `xopc-cloud/computer` and complete the [native setup](./computer-use.md).
5. Review displayed usage and limits before batch generation or long calls.

New installations default to `xopc-cloud/auto`, which still requires authorization. You can choose your own API key or a local service instead. After upgrading and loading the cloud catalog, previous cloud references migrate by capability; third-party model choices are preserved. For an unavailable model, update the app, reload the catalog and explicitly select an available service instead of entering an old supplier model ID.

Model and voice labels follow the interface language (`zh-CN` or `en`), with the original name as a fallback. Localized labels do not change model IDs. The hosted voice ID is `default`, displayed as “默认音色” or “Default voice”.

The previous cloud Computer Use ID `computer-gui-plus-preview` migrates to `computer`; the GUI-Plus capability stays available through the dedicated entry.

A public service name does not promise a fixed underlying supplier. Submitted context follows the cloud service's data boundary; connecting does not automatically upload the entire local database. See [XOPC Platform](./platform.md) for platform connection and private deployments.
