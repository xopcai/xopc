# Image & vision (multimodal)

xopc can **receive images** in chat, run **vision / image understanding** with the `image` tool, and **generate images** with the `image_generate` tool when models and API keys are configured.

---

## Configuration

| Field | Type | Purpose |
|-------|------|---------|
| Agent model roles | `agents.list[].models.roles` | The selected chat model may receive images directly when it supports vision. |
| Image generation providers | Provider credentials / image provider registry | `image_generate` discovers available generation providers at runtime. |
| Media size limits | Runtime/gateway limits | Maximum upload and tool payload sizes depend on the route/tool in use. |

Use `xopc image status` to inspect current manifest-era behavior and `xopc image providers` to list available generation providers.

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
| GET | `/api/image/capabilities` | Snapshot of image-related settings and available provider/model hints. |
| POST | `/api/image/validate-model` | Body `{ "modelRef": "provider/model" }` — checks format, keys, and registry resolution. |
| GET / PATCH | `/api/config` | Read or update gateway/runtime configuration. |

---

## CLI

`xopc image` — `status` explains current image behavior; `providers` lists available image generation providers. `xopc models list` may show `[gen]` / `[vision]` hints where applicable.

---

## Related

- [Configuration](configuration.md) — runtime and provider configuration.
- [Gateway](gateway.md) — HTTP API overview.
- [CLI](cli.md) — `xopc image`.
- [Tools](tools.md) — `image` / `image_generate`.
