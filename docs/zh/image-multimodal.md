# 图像与视觉（多模态）

xopc 支持在对话中**接收图片**、通过 **`image` 工具**做**图像理解 / 视觉分析**，并在配置好模型与 API Key 时使用 **`image_generate` 工具**进行**文生图**。

---

## 配置

| 字段 | 类型 | 作用 |
|------|------|------|
| Agent 模型角色 | `agents.list[].models.roles` | 所选对话模型支持视觉时，图片可直接进入模型。 |
| 图片生成模型 | `agents.list[].models.imageGenerationModel` | 为每个 Agent 选择一个内置 Provider/模型。 |
| 媒体大小限制 | 运行时 / gateway 限制 | 上传和工具载荷上限取决于具体路由或工具。 |

目录包含 OpenAI、Google、阿里云百炼、MiniMax 和 fal。连接 XOPC Model Service
OAuth 后，平台发布的图片模型会自动作为 `xopc-cloud` Provider 出现，复用现有
OAuth 授权，无需再配置 API Key。通过 **设置 → 能力 → 图片** 完成模型选择；
凭据不会写入 `xopc.json`。

---

## 行为说明

- **入站图片** — 当**会话主模型**支持视觉时，图片以原生图像部件进入模型；否则会先用支持视觉的模型转成文字描述再进入主流程。  
- **`image` 工具** — 使用运行时解析出的视觉能力做描述或分析。  
- **`image_generate` 工具** — 使用 `imageGenerationModel` 与已注册的生成提供方。部分提供方支持**图生图 / 编辑**；具体参数以当前版本的工具 schema 为准。

参数摘要见 [内置工具 — 图像](tools.md#图像)。

---

## 网关 API（需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/image-generation/catalog` | 列出内置 Provider、模型与凭据状态。 |
| GET | `/api/agents/:agentId/image-generation` | 读取指定 Agent 的图片生成模型。 |
| POST | `/api/agents/:agentId/image-generation/setup` | 一次保存可选 API Key 并启用 Provider/模型。 |
| POST | `/api/image-generation/providers/:providerId/verify` | Provider 支持轻量检查时验证凭据。 |

---

## CLI

`xopc image` — `status` 说明当前图像行为；`providers` 列出可用图像生成 provider。`xopc models list` 可能对生成 / 视觉相关模型标注 `[gen]` / `[vision]`。

---

## 相关文档

- [配置参考](configuration.md) — 运行时与 provider 配置。  
- [网关服务](gateway.md) — HTTP API 总览。  
- [CLI 命令](cli.md) — `xopc image`。  
- [内置工具](tools.md) — `image` / `image_generate`。
