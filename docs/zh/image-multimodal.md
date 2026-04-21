# 图像与视觉（多模态）

xopc 支持在对话中**接收图片**、通过 **`image` 工具**做**图像理解 / 视觉分析**，并在配置好模型与 API Key 时使用 **`image_generate` 工具**进行**文生图**。

---

## 配置（`agents.defaults`）

| 字段 | 类型 | 作用 |
|------|------|------|
| `imageModel` | `string` 或 `{ primary, fallbacks? }` | **`image` 工具**及**主对话模型不支持视觉**时对入站图片做描述的模型链。 |
| `imageGenerationModel` | `string` 或 `{ primary, fallbacks? }` | **`image_generate`** 使用的文生图模型链（如 `openai/gpt-image-1`、`dashscope/wan2.6-t2i`）。 |
| `mediaMaxMb` | `number`（可选） | **`image` 工具**加载单张图片时的体积上限（MB）。 |

若未填写 `imageModel` / `imageGenerationModel`，运行时会根据已配置的 Provider **自动推断**合理候选。

---

## 行为说明

- **入站图片** — 当**会话主模型**支持视觉时，图片以原生图像部件进入模型；否则会先用支持视觉的模型转成文字描述再进入主流程。  
- **`image` 工具** — 使用 `imageModel` 及其 fallback 做描述或分析。  
- **`image_generate` 工具** — 使用 `imageGenerationModel` 与已注册的生成提供方。部分提供方支持**图生图 / 编辑**；具体参数以当前版本的工具 schema 为准。

参数摘要见 [内置工具 — 图像](tools.md#图像)。

---

## 网关 API（需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/image/capabilities` | 图像相关配置快照与 Provider / 模型提示。 |
| POST | `/api/image/validate-model` | 请求体 `{ "modelRef": "provider/model" }`，校验格式、密钥与模型解析。 |
| GET / PATCH | `/api/config` | 读取或更新 `imageModel`、`imageGenerationModel` 及主备字段。 |

---

## CLI

`xopc image` — 子命令如 `status`、`set-understanding`、`set-generation`、`add-fallback`、`remove-fallback`、`providers`、`set-max-size` 等。`xopc models list` 可能对生成 / 视觉相关模型标注 `[gen]` / `[vision]`。

---

## 相关文档

- [配置参考](configuration.md) — `agents.defaults` 完整说明。  
- [网关服务](gateway.md) — HTTP API 总览。  
- [CLI 命令](cli.md) — `xopc image`。  
- [内置工具](tools.md) — `image` / `image_generate`。
