# Image & vision (multimodal)

This page describes how xopc handles **inbound images**, **vision models**, **image understanding** (`image` tool), and **image generation** (`image_generate`), and how that maps to the internal design in `.docs/image/`.

---

## Alignment with `.docs/image`

| Design phase (`.docs/image`) | Status in code |
|------------------------------|----------------|
| **1** — Image generation provider registry | `registerImageGenerationProvider` in `src/agent/image/generation/provider-registry.ts`; built-ins registered from `openai-generate.ts` and `dashscope-generate.ts`; `generateImage()` in `generation/runtime.ts` resolves providers via the registry. |
| **2** — Image understanding provider abstraction | `src/agent/image/understanding/` — registry + pi-ai bridge for `openai`, `anthropic`, `google`, `qwen`; entry `describeImages()` in `understanding/runtime.ts`. `describeImagesWithPiAi` remains as a thin wrapper. |
| **3** — Native vision first | `modelSupportsVision` / `resolveImageHandlingStrategy` in `vision-detection.ts`. Inbound images are passed **as image parts** when the **session model** supports vision; otherwise a vision model describes them as text (`inbound-image-handling.ts`), used by `AgentOrchestrator` and `AgentService`. |
| **4** — Edit / image-to-image + understanding fallbacks | `ImageGenerationRequest.inputImages` + OpenAI **`POST /v1/images/edits`** (multipart; **first** reference image only). Qwen declares `supportsEdit: false`. `describeImagesWithFallback()` chains models for the describe path. |
| **5** — Gateway & console | `GET /api/image/capabilities`, `POST /api/image/validate-model`; `GET`/`PATCH /api/config` expose `imageModelFallbacks` / `imageGenerationModelFallbacks` and accept `{ primary, fallbacks }` for image fields. Gateway console **Agent defaults** includes fallback rows for both image settings. |
| **6** — CLI | `xopc image` (`status`, `set-understanding`, `set-generation`, `add-fallback`, `remove-fallback`, `providers`, `set-max-size`). `xopc models list` shows `[gen]` / `[vision]` hints where applicable. |

**Intentional differences from early `.docs` sketches**

- OpenAI **edits** use **`multipart/form-data`** (per API), not a JSON body with embedded `image_url` objects.
- **`image_generate`** does not yet expose reference images in its Typebox schema; **`generateImage({ inputImages })`** is available for callers that use the API programmatically.

---

## Configuration (`agents.defaults`)

| Field | Type | Purpose |
|-------|------|---------|
| `imageModel` | `string` or `{ primary, fallbacks? }` | Vision / image-understanding model for the **`image`** tool and for **describing** inbound images when the chat model is not vision-capable. |
| `imageGenerationModel` | `string` or `{ primary, fallbacks? }` | Model chain for **`image_generate`** (e.g. `openai/gpt-image-1`, `qwen/wan2.6-t2i`). |
| `mediaMaxMb` | `number` (optional) | Max size when loading images for the **`image`** tool. |

If `imageModel` / `imageGenerationModel` are omitted, the runtime **infers** candidates from configured providers (same idea as before; see `resolveImageModelConfigForTool` in `tool-model-config.ts`).

---

## Tools

- **`image`** — Uses `runWithImageModelFallback` over `describeImagesWithPiAi` (which calls the shared `describeImages` path). Configure primary + fallbacks via `imageModel`.
- **`image_generate`** — Uses `generateImage()` and the generation registry. `action: "list"` reflects registered providers via `listImageGenerationProvidersSummary()`.

See [Built-in Tools](tools.md#vision--image-generation) for parameter summaries.

---

## Gateway API (authenticated)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/image/capabilities` | Current image-related config snapshot + provider/model hints for generation and vision. |
| POST | `/api/image/validate-model` | Body `{ "modelRef": "provider/model" }` — format check, provider key presence, `resolveModel` registry check. |
| GET/PATCH | `/api/config` | Defaults include `imageModelFallbacks`, `imageGenerationModelFallbacks`; PATCH supports object form for `imageModel` / `imageGenerationModel`. |

---

## Extending with code

- **Generation:** `registerImageGenerationProvider({ id, generateImage, capabilities?, ... })` from `src/agent/image/generation/provider-registry.ts` (also re-exported from `src/agent/image/index.ts`).
- **Understanding:** `registerImageUnderstandingProvider` from `src/agent/image/understanding/provider-registry.ts`.

---

## Related

- [Configuration](configuration.md) — full `agents.defaults` table including image fields.
- [Gateway](gateway.md) — API list.
- [CLI](cli.md) — `xopc image`.
- [Tools](tools.md) — `image` / `image_generate`.
