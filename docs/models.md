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

## One-page model service setup

Open **Add provider** in model settings or choose a service during first-run setup. The same page connects an account/API key and previews **Chat and tasks**, **Image understanding**, **Image generation**, **Background tasks**, **Recorded audio recognition**, **Speech synthesis**, and **Realtime conversation**. Voice uses appear only with bindings supported by that service; unsupported uses remain unavailable. Connected services expose **Configure model uses** from management; each use on the settings page also has a **Change** action.

The default **Fill missing** mode retains uses and task intents backed by configured providers. **Switch to this service** explicitly replaces the checked uses. Expand a use to choose another eligible catalog model. The chat selection also assigns available fast/reasoning/coding/review recommendations; no recommendation is invented for an ambiguous catalog. You can connect a service without changing any use.

Recommendations come from a shared server-side engine over the existing pi catalog and media adapters. The preview includes the current routes and a configuration/catalog revision. Concurrent changes require a fresh review. Credentials and model assignments are saved separately, so a failed assignment can be retried with the saved connection. The flow does not make a billable test request or claim that account quota/model access has been verified.

Only checked global uses change. Their fallback lists are cleared, and image auto-provider fallback is disabled. Agent/session overrides, unselected voice uses, Computer Use and the explicit `understanding` intent keep their existing configuration. Explicit empty Agent fallback lists remain empty; they do not acquire a global provider fallback.

### Alibaba Bailian subscription

Select the Beijing subscription access method and enter its Token Plan API key. This reuses pi's `qwen-token-plan-cn` provider and catalog without creating a custom `models.json` provider. The current preferred models are Qwen 3.8 Flash for chat/vision and Qwen 3.8 Max for complex tasks, when present in the catalog.

Image generation shares that credential and the existing DashScope adapter through `https://token-plan.cn-beijing.maas.aliyuncs.com`. The registered models are `qwen-image-3.0-pro` and `wan2.7-image`; setup recommends the former. Initial support is text-to-image at 1024×1024. Image editing is not advertised by this adapter.

Voice uses the same stored `qwen-token-plan-cn` credential, without copying it into speech configuration. `qwen-audio-3.0-tts-plus` uses the subscription TTS endpoint (MP3, 24 kHz, default voice `longanhuan_v3.6`), accepting both direct audio and the JSON audio-link response observed in live testing. `qwen-audio-3.0-asr-flash` reuses the existing recorded-audio recognition adapter through the subscription host. `qwen-audio-3.0-realtime-plus` reuses the existing native WebSocket conversation engine with default voice `longanqian`. Selecting realtime conversation makes it the default voice conversation mode. This recorded-audio adapter does not advertise streaming dictation or substitute an unverified streaming model. Audio links are downloaded through the SSRF guard; HTTP links are fetched over HTTPS with the signed path/query preserved. Speech synthesis uses the one-shot protocol; low-latency standalone TTS streaming is not advertised. See [multimodal integration](https://help.aliyun.cn/zh/model-studio/token-plan-multimodal-gen), [ASR HTTP protocol](https://help.aliyun.com/en/model-studio/fun-asr-flash-recorded-speech-recognition-http-api), and [realtime endpoints](https://help.aliyun.cn/zh/model-studio/realtime-token-authentication).

Voice assignments disable cross-provider fallback. Merely connecting a subscription does not add it to automatic STT/TTS selection. Existing ordinary DashScope keys, models, voices and endpoints stay separate. Voice settings and SQLite model defaults have separate storage: setup saves voice first, then rechecks model defaults before writing them. Voice-save failures leave model defaults unchanged; concurrent default changes after a voice save return an explicit partial-save message and require review, rather than overwriting the newer defaults.

For team-specific Base URLs, use the advanced custom-provider form with the address supplied by the console. See [subscription terms and models](https://help.aliyun.cn/zh/model-studio/token-plan-personal-overview).

### Background usage scope

`models.background` is an optional route with the same global-default/Agent-override layers as other model settings. Background calls use it when inheriting the default chat route. An explicitly selected model or task intent still undergoes usage-scope validation.

Provider names, subscription types and endpoint addresses do not restrict background or unknown calls. Any configured provider's eligible catalog models can be selected for background work. Call origins are still recorded for attribution: automations, system jobs and idle compaction are background work; synchronous children inherit their parent origin. This classification does not block a provider.

Selecting a background model does not enable tasks or change other configured routes. Credentials, model capabilities and availability are still checked. A missing usable model does not silently select another billing source. Changing provider scope policy does not enable cross-service fallback.


The generic engine, authenticated HTTP routes and browser setup flows are covered with Alibaba `qwen-token-plan-cn`, XOPC Cloud and Xiaomi `xiaomi-token-plan-cn`. The regression checks use catalog metadata and isolated test credentials. A separate explicit live probe, `pnpm exec tsx scripts/verify-bailian-live.mts`, uses the existing local Gateway and saved subscription credential; it makes paid calls, creates/removes temporary diagnostic conversations, and writes sanitized reports/audio/image artifacts to a temporary directory. Optional modes include `--chat --vision --image`, `--only=voice`, `--only=reasoning`, `--only=omni --pcm=<16-kHz-PCM-file>`, `--only=policy`, and `--only=browser`. It does not change provider configuration. Live verification on 2026-10-16 covered Flash/Max chat, vision, image generation, speech-to-transcription round trip, and the subscription native conversation engine. The native-engine probe is distinct from the currently saved natural-conversation provider; the report records that provider without switching it.

## pi 1.1 provider changes

Use `openai` for both API keys and **Sign in with ChatGPT**. Subscription users must sign in again with `xopc models auth login --provider openai`; old `openai-codex` credentials are not reused. A stored API key profile takes precedence over OAuth; remove that profile when choosing subscription access. An environment key is used when no stored profile or OAuth credential exists.

Use `azure` as the Azure provider ID. The `azure-openai-responses` API protocol and `AZURE_OPENAI_*` environment variables remain valid. Update Agent defaults, model intents, session overrides that reference the old provider ID. Removed provider identities fail explicitly and do not select another model.

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
