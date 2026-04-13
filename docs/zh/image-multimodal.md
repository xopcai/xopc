# 图像与视觉（多模态）

本文说明 xopc 如何处理**入站图片**、**视觉模型**、**图像理解**（`image` 工具）与**文生图**（`image_generate`），以及与仓库内设计文档 `.docs/image` 的对应关系。

---

## 与 `.docs/image` 设计稿的对照

| 设计阶段（`.docs/image`） | 代码实现情况 |
|--------------------------|-------------|
| **1** — 文生图 Provider 注册表 | `src/agent/image/generation/provider-registry.ts` 的 `registerImageGenerationProvider`；`openai-generate.ts`、`dashscope-generate.ts` 在加载时注册；`generation/runtime.ts` 的 `generateImage()` 通过注册表调度。 |
| **2** — 图像理解 Provider 抽象 | `src/agent/image/understanding/`：注册表 + 对 `openai` / `anthropic` / `google` / `qwen` 的 pi-ai 桥接；对外入口 `describeImages()`。`describeImagesWithPiAi` 仍为薄封装。 |
| **3** — Vision 原生优先 | `vision-detection.ts` 中 `modelSupportsVision` / `resolveImageHandlingStrategy`。会话**主模型**支持视觉时，入站图以 **image 部件**直传；否则用视觉模型先描述为文本（`inbound-image-handling.ts`），`AgentOrchestrator` 与 `AgentService` 均已接入。 |
| **4** — 图生图 + 理解 Fallback | `ImageGenerationRequest.inputImages`；OpenAI 走 **`POST /v1/images/edits`**（**multipart**，当前仅使用**第一张**参考图）。Qwen 侧声明 `supportsEdit: false`。`describeImagesWithFallback()` 在「描述」路径上做多模型降级。 |
| **5** — 网关与控制台 | `GET /api/image/capabilities`、`POST /api/image/validate-model`；`GET`/`PATCH /api/config` 增加 `imageModelFallbacks`、`imageGenerationModelFallbacks`，并支持 `imageModel` / `imageGenerationModel` 的 `{ primary, fallbacks }`。控制台「智能体默认项」中已为两类图像配置提供备用模型列表。 |
| **6** — CLI | `xopc image`（`status`、`set-understanding`、`set-generation`、`add-fallback`、`remove-fallback`、`providers`、`set-max-size`）；`xopc models list` 对生成 / 视觉相关模型标注 `[gen]` / `[vision]`。 |

**与早期设计草稿的差异（有意为之）**

- OpenAI **编辑接口**按官方要求使用 **`multipart/form-data`**，而非 JSON 里嵌 `image_url`。
- **`image_generate` 工具**暂未在参数里暴露参考图；程序侧可调用 **`generateImage({ inputImages })`**。

---

## 配置（`agents.defaults`）

| 字段 | 类型 | 作用 |
|------|------|------|
| `imageModel` | `string` 或 `{ primary, fallbacks? }` | **`image` 工具**及**主模型无视觉**时对入站图做描述的视觉模型链。 |
| `imageGenerationModel` | `string` 或 `{ primary, fallbacks? }` | **`image_generate`** 使用的文生图模型链（如 `openai/gpt-image-1`、`qwen/wan2.6-t2i`）。 |
| `mediaMaxMb` | `number`（可选） | **`image` 工具**加载单图时的体积上限。 |

未配置时，运行时会按已配置的 Provider 等信息**推断**可用模型（见 `tool-model-config.ts` 中的 `resolveImageModelConfigForTool`）。

---

## 内置工具

- **`image`** — 通过 `runWithImageModelFallback` 调用 `describeImagesWithPiAi`（内部走统一的 `describeImages`）。用 `imageModel` 配置主备。
- **`image_generate`** — 调用 `generateImage()` 与生成侧注册表；`action: "list"` 时列出已注册 Provider 摘要。

参数说明见 [内置工具 — 图像](tools.md#图像)。

---

## 网关 API（需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/image/capabilities` | 当前图像相关配置快照 + 生成 / 视觉的 Provider 与模型提示。 |
| POST | `/api/image/validate-model` | 请求体 `{ "modelRef": "provider/model" }`：格式、密钥、`resolveModel` 校验。 |
| GET/PATCH | `/api/config` | 默认项含图像主备字段；PATCH 支持图像模型的对象形式。 |

---

## 代码扩展

- **文生图：** 在扩展或核心代码中调用 `registerImageGenerationProvider`（`src/agent/image/generation/provider-registry.ts`，`src/agent/image/index.ts` 重导出）。
- **图像理解：** `registerImageUnderstandingProvider`（`src/agent/image/understanding/provider-registry.ts`）。

---

## 相关文档

- [配置参考](configuration.md) — `agents.defaults` 完整说明（含图像字段）。
- [网关服务](gateway.md) — API 列表。
- [CLI 命令](cli.md) — `xopc image`。
- [内置工具](tools.md) — `image` / `image_generate`。
