# Image & vision (multimodal)

xopc can **receive images** in chat, run **vision / image understanding** with the `image` tool, and **generate images** with the `image_generate` tool when models and API keys are configured.

---

## Configuration (`agents.defaults`)

| Field | Type | Purpose |
|-------|------|---------|
| `imageModel` | `string` or `{ primary, fallbacks? }` | Model used for the **`image`** tool and for **describing** inbound images when the main chat model does not support vision. |
| `imageGenerationModel` | `string` or `{ primary, fallbacks? }` | Model chain for **`image_generate`** (for example `openai/gpt-image-1`, `dashscope/wan2.6-t2i`). |
| `mediaMaxMb` | `number` (optional) | Maximum image size (MB) when loading images for the **`image`** tool. |

If `imageModel` or `imageGenerationModel` is omitted, xopc **infers** sensible defaults from the providers you have configured.

---

## Behaviour

- **Inbound images** — When the **session model** supports vision, images are sent to the model as native image parts. Otherwise a vision-capable model may describe them as text first.
- **`image` tool** — Describes or analyses images using `imageModel` and its fallbacks.
- **`image_generate` tool** — Creates images using `imageGenerationModel` and the configured generation providers. Some providers support **edits** (image-to-image) via the HTTP API; tool parameters follow the published schema for your xopc version.

See [Built-in Tools](tools.md#vision--image-generation) for parameter summaries.

---

## Gateway API (authenticated)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/image/capabilities` | Snapshot of image-related settings and available provider/model hints. |
| POST | `/api/image/validate-model` | Body `{ "modelRef": "provider/model" }` — checks format, keys, and registry resolution. |
| GET / PATCH | `/api/config` | Read or update `imageModel`, `imageGenerationModel`, and related fallback fields. |

---

## CLI

`xopc image` — subcommands such as `status`, `set-understanding`, `set-generation`, `add-fallback`, `remove-fallback`, `providers`, `set-max-size`. `xopc models list` may show `[gen]` / `[vision]` hints where applicable.

---

## Related

- [Configuration](configuration.md) — full `agents.defaults` reference.
- [Gateway](gateway.md) — HTTP API overview.
- [CLI](cli.md) — `xopc image`.
- [Tools](tools.md) — `image` / `image_generate`.
