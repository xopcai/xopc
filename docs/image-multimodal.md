# Image & vision (multimodal)

xopc can **receive images** in chat, run **vision / image understanding** with the `image` tool, and **generate images** with the `image_generate` tool when models and API keys are configured.

---

## Configuration

| Field | Type | Purpose |
|-------|------|---------|
| Agent model roles | `agents.list[].models.roles` | The selected chat model may receive images directly when it supports vision. |
| Image generation model | `agents.list[].models.imageGenerationModel` | Selects one built-in provider/model for each agent. |
| Media size limits | Runtime/gateway limits | Maximum upload and tool payload sizes depend on the route/tool in use. |

The catalog contains OpenAI, Google, Alibaba Model Studio, MiniMax, and fal. When
XOPC Model Service OAuth is connected, its published image models also appear as
the `xopc-cloud` provider automatically; they use the existing OAuth grant and do
not require a second API key. Configure the selection in **Settings → Capabilities
→ Image**; credentials are stored outside `xopc.json`.

When first-time onboarding selects XOPC Model Service, xopc automatically configures
the first available image-generation model from the platform catalog. Existing explicit
image-generation settings are preserved.

---

## Behaviour

- **Inbound images** — When the **session model** supports vision, images are sent to the model as native image parts. Otherwise a vision-capable model may describe them as text first.
- **`image` tool** — Describes or analyses images using the resolved vision-capable runtime.
- **`image_generate` tool** — Creates images using `imageGenerationModel` and the configured generation providers. Some providers support **edits** (image-to-image) via the HTTP API; tool parameters follow the published schema for your xopc version.

See [Built-in Tools](tools.md#vision--image-generation) for parameter summaries.

---

## Gateway API (authenticated)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/image-generation/catalog` | List the built-in providers, models, and credential status. |
| GET | `/api/agents/:agentId/image-generation` | Read the selected image generation model for one agent. |
| POST | `/api/agents/:agentId/image-generation/setup` | Store an optional API key and enable a provider/model in one operation. |
| POST | `/api/image-generation/providers/:providerId/verify` | Verify a credential when the provider supports a lightweight check. |

---

## CLI

`xopc image` — `status` explains current image behavior; `providers` lists available image generation providers. `xopc models list` may show `[gen]` / `[vision]` hints where applicable.

---

## Related

- [Configuration](configuration.md) — runtime and provider configuration.
- [Gateway](gateway.md) — HTTP API overview.
- [CLI](cli.md) — `xopc image`.
- [Tools](tools.md) — `image` / `image_generate`.
