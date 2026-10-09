# 图片生成 Provider 接入与模型更新

日期：2026-10-09。状态：已实施，未部署，未执行付费上游实测。

## 实施决策

xopc BYOK 和 xopc-platform 共用 `packages/image-providers`：模型目录、能力类型、严格校验、厂商协议执行。它不依赖 Agent、数据库、OAuth 或任一项目的服务框架。xopc 使用私有 workspace 开发依赖，构建时打包；platform 使用 `vendor/image-providers` 编译快照，构建时同样打包。快照携带文件 SHA-256 来源记录，运行时无需另一个仓库或尚未发布的 npm 包。

厂商 adapter 只负责协议和生成结果。xopc 负责凭据、HTTP 配置、网络策略、Agent 工具和文件保存；platform 负责密钥加密、管理鉴权、版本化服务发布、路由和计费。沿用现有服务发布流程，不增加另一套发布入口。

按最终要求删除旧 adapter、旧模型目录、旧能力结构和尺寸自动转换。只有一种嵌套能力契约：`generate / edit / geometry / output`。旧型号不提供别名、静默升级或兼容执行；旧请求的 `response_format` 在 platform 直接拒绝。像素尺寸 `size`、宽高比 `aspectRatio`、分辨率 `resolution` 各自校验，不互相代替。非法数量不取整、不截断；不支持的参数不忽略。

## 当前目录

| Provider ID | 模型与协议 |
| --- | --- |
| `openai` | GPT Image 2.5 Flare / Sunburst；JSON 生成、multipart 编辑，不发送旧 response_format |
| `dashscope` | Qwen Image 3.0 Pro / 3.0、Wan 2.7 Pro / 普通版；原生 multimodal-generation，区域显式选择 |
| `minimax` | image-01 / image-01-live；原生 image_generation，区域显式选择；未发现可靠的新型号依据，不凭版本数字移除 |
| `google` | Nano Banana 2.1、Nano Banana 2 Lite、Nano Banana Pro；Interactions 生成和参考图输入，store=false |
| `fal` | FLUX.2 Pro、Nano Banana 2.1、FLUX.2 Klein 4B；生成和编辑使用各自端点，队列提交、轮询、取结果 |
| `seedream` | Seedream 5.0 Flash 260915 / Pro 260628；Ark 原生 Images，不发送组图参数 |
| `ideogram` | Ideogram 4.5；v2 生成 JSON、精准编辑 multipart；编辑不声明更改尺寸 |
| `bfl` | FLUX.2 Pro / Max / Klein 4B；原生任务和轮询 |
| `zhipu-cn` | GLM-Image；原生 Images，文本输入、URL 输出，512–2048 边长且为 32 的倍数 |
| `tokenhub` | Hy Image 3.5 Preview 原生同步 Messages 与 Hy Image 3.0 原生同步 prompt；两者各自解析当前响应 |
| `stability` | Stable Image Ultra / Core；v2beta multipart 与二进制图片输出 |

产品目录使用保守能力上限，未承诺覆盖所有厂商参数。大部分模型每次一张，OpenAI 与 Ideogram最多四张；Wan 单次一张，避免 Pro 的 4K 与组图限制冲突。Wan Pro 文生图与参考图的尺寸上限分开声明。TokenHub 3.5 Preview 是预览型号，单轮参考图编辑可用，不引入服务端多轮历史存储。

未实现 FLUX 3：官方索引出现名称，但未读到足够完整的调用契约。Google 多轮上下文、特殊遮罩、厂商全部扩展参数也不属于当前生成/参考图接口。

## 配置与目录更新

xopc 在图像设置中通过统一目录选模型、配置 BYOK。内置 provider 可设置 baseUrl；有地域的 provider 必须选择地域。自定义服务仍显式配置 `models.json.providers.<id>.imageGeneration` 的 OpenAI Images 协议、认证、路径和能力；Azure 等特殊部署使用显式自定义 provider，不增加原生 adapter 的兼容分支。

platform 提供 13 个地域预设，创建连接支持 `presetId / apiKey / name / baseUrl`。管理页新增名称、地址和“同步模型”。管理接口：

```text
POST /api/v1/admin/image-providers/:id/models/sync
```

启动和显式同步使用同一目录：删除退出目录的库存模型；能力变化时删除旧库存记录、关联路由，写入当前能力并清除验证状态；没有有效目标的公开模型停用。已移除的 provider 预设删除连接，不提供地域 ID 别名。使用当前目录的相同能力记录保留验证状态和更新时间，重启不会无端使验证失效。升级后需要重新选择、验证并发布服务。旧服务版本仍是审计记录，不会恢复成执行路由。

同一个图片服务的备用目标必须具有完全相同的能力契约，发布时校验。图片选路最多三次；只有明确提交被拒绝的 401/403/429 可尝试下一目标。超时、未知网络错误、无效输出、内容错误、任务提交后的轮询/下载错误立即结束，不再次提交付费任务。全过程有总超时，并传递取消信号。

公开请求示例：

```json
{
  "model": "published-image-service",
  "prompt": "A quiet garden",
  "n": 1,
  "xopc": { "image": { "aspectRatio": "16:9", "resolution": "2K" } }
}
```

仅向支持这些选项的模型发送。编辑 multipart 的 `xopc` 是同样结构的 JSON 字符串；像素型模型使用 `size`。输出统一为 `data[].b64_json + mime_type`。

## 运行约束

请求先校验模型、生成/编辑能力、数量、尺寸、格式、参考图数量和输入字节。上游响应有单图和总字节边界，base64 和图片签名校验；MIME 取实际字节。远程图片下载不携带 provider 凭据，异步轮询地址必须来自可信 provider 主机；禁用重定向，两端沿用各自 SSRF 策略。

尚未增加异步任务持久化和跨重启恢复。接受任务后轮询失败会返回失败，不能据此推断上游没有收费。当前实现通过停止自动重提交控制重复生成。

## 共享快照维护

在 xopc 仓库执行：

```bash
node scripts/sync-image-providers.mjs /path/to/xopc-platform
```

脚本编译、替换 platform 的整个受控快照目录，并生成 `source.json`。两个仓库的目录、协议、快照与锁文件必须一起审阅。快照不是运行时双目录，也不做协议版本协商。两端应协调部署；旧客户端与新平台之间不提供旧能力投影。

## 验证

共享模块使用官方协议结构的 mock，覆盖全部 provider 的生成及所声明的编辑路径、严格参数拒绝、返回字节、异步任务、轮询地址和字节上限。xopc 覆盖 registry、运行时、BYOK 配置、自定义服务、云目录、工具与网关设置；platform 覆盖管理连接、库存清理、服务验证发布、OAuth 生成/编辑和按实际图片数结算。两端类型检查、Node 与 Web 构建需要通过。

这些是本地协议与集成验证，不代表每个账号具有对应模型、地域和配额权限。未执行真实付费生成或部署操作。

## 官方依据

- [OpenAI 图像生成](https://developers.openai.com/api/docs/guides/image-generation)、[Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)、[Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)。
- [Google 图像生成](https://ai.google.dev/gemini-api/docs/image-generation)。
- [Qwen 图像 API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)、[Wan 图像 API](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)。
- [Seedream](https://docs.volcengine.com/docs/ark/seedream-4-0-5-0?lang=zh)、[模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=en)。
- [Ideogram API](https://developer.ideogram.ai/ideogram-api/api-overview)。
- [fal FLUX.2 Pro](https://fal.ai/models/fal-ai/flux-2-pro/api)、[fal Nano Banana 2.1](https://fal.ai/models/google/nano-banana-2.1/api)。
- [BFL FLUX.2](https://docs.bfl.ai/flux_2/flux2_overview)。
- [GLM-Image](https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image)、[TokenHub Hy 图片 API](https://cloud.tencent.com/document/product/1823/135745)、[Stability API](https://platform.stability.ai/docs/api-reference)。
