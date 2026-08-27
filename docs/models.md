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

## Use a local model

1. Install and start a supported server such as Ollama, LM Studio, or vLLM.
2. Confirm its API is reachable from the machine or container running xopc.
3. Add the provider or compatible endpoint in Model settings.
4. Select a model that is actually downloaded and served.
5. Send a small Chat request.

When xopc runs in Docker, `127.0.0.1` points to the container, not the host. Use the host address supported by your Docker installation.

Local execution improves control over request handling, but model files, hardware requirements, and runtime logs remain your responsibility.

## Default model and Agent model roles

The global default is used when an Agent does not specify another model. Set it with:

```bash
xopc models set <provider>/<model>
```

Advanced Agents and Workflows can use named roles such as a fast model for simple steps and a larger model for synthesis. Configure these in the Agent editor only when the extra complexity gives a clear cost or quality benefit.

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
