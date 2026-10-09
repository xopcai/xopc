# Personal AI 音乐创作与播放：调研、产品方案与实施规格

日期：2026-10-09。状态：调研与设计完成，待实现。适用仓库：`xopc`、`xopc-platform`。

跨仓库实现契约、数据模型、异步执行与实施拆分见 [音乐创作能力技术方案](./technical/music-generation-architecture.md)。技术细节以该方案为准。

> **产品方向修订（2026-10-09）**：音乐作为独立创作能力与模块，供所有 Agent 按模型配置和工具权限调用。Personal AI 的默认体验为自然语言快速创作与音乐作品交付，歌词和参数编辑进入独立音乐创作界面。下文早期的聊天内完整草稿布局不再是默认路径；最新交互定义见第 12 节。

## 1. 产品决策

让用户对 Personal AI 说一句话，就能得到一首能听、能保存、能继续修改的音乐作品。音乐生成成为独立模型能力，作品使用现有媒体存储与鉴权链路交付。音乐模型与聊天模型、TTS 模型分别配置。

第一版包含：聊天创作、歌曲／纯音乐、AI 写词／自定义歌词、生成状态、音乐作品卡、播放／暂停／拖动／下载、再次创作、音乐能力配置、XOPC Cloud 登录后自动配置可用模型。

首批提供 MiniMax 适配器；云端是否默认推荐，取决于平台账号的真实调用资格和验证结果。Provider 与模型能力使用注册表，后续接入 ElevenLabs 等服务无需改变创作入口和作品格式。

第一版以聊天为主入口、作品详情为编辑入口。歌曲库、跨页面持续播放、精细音轨编辑分阶段推进。用已有作品机制聚合音乐，避免第一版就增加一个与聊天割裂的大型音乐工作台。

音乐模型生成的人声不自动等于 Personal AI 的固定声音。第一版可通过描述选择人声风格，不承诺用同一 TTS 音色唱歌；指定音色、克隆、翻唱须独立声明模型能力。

## 2. 调研方法与结论

基于产品官方页面、帮助中心和 API 文档进行桌面调研，未付费实测音质、延迟或商业可用性。以下功能是文档事实；对 xopc 的取舍是产品判断。

| 产品 | 官方可核实的交互 | 对 xopc 的启发 | 第一版取舍 |
| --- | --- | --- | --- |
| Suno | 简单描述创作；Custom 模式编辑歌词与风格；纯音乐切换；成品后继续编辑 | 入门只需一句话，歌词和高级参数渐进展开 | 保留歌曲／纯音乐和歌词编辑，后续再做复杂编辑 |
| Udio | 描述创作；歌词生成与手动编辑；Extend；Sessions 中保存 takes、撤销和局部替换 | 试听与修改是连续过程，需要保留旧版本 | “再做一个版本”保留原作；暂不承诺延长或局部重写 |
| ElevenLabs Music | prompt 或 composition plan；独立纯音乐控制；时长参数；音乐 API 返回音频 | Provider 能力存在差异，产品不能假设所有模型参数相同 | 注册能力决定是否显示时长等选项；作为后续适配对象 |

来源：[Suno 简单与自定义创作](https://help.suno.com/en/articles/2415873)、[Suno Custom 模式](https://help.suno.com/en/articles/3197377)、[Udio 首次创作](https://help.udio.com/en/articles/10715838-create-your-first-song)、[Udio 歌词编辑](https://help.udio.com/en/articles/10716221-create-a-song-with-your-own-lyrics)、[Udio Sessions](https://www.udio.com/blog/sessions)、[ElevenLabs Compose API](https://elevenlabs.io/docs/api-reference/music/compose/)。

产品判断：xopc 的价值是“了解用户意图并完成创作”，让 Personal AI 写词、整理风格、调用模型、交付作品。第一版重点应是生成到试听的闭环，以及自然语言反馈后的版本管理。参数面板服务于表达意图，不要求用户先学习音乐制作术语。

## 3. MiniMax 接入事实与上线条件

2026-10-09 查询的官方 API 页面包含服务调整公告：自 2026-08-20 起，付费音乐／歌词 API 不再向新用户开放，已有付费用户可继续调用；免费音乐 API 停服。文档仍保留接口和部分旧权限描述，不能把模型枚举当作实际 entitlement。[官方接口与公告](https://platform.minimax.io/docs/api-reference/music-generation)

当前文档推荐 `music-3.0`，并列出 `music-2.6`。Hosted 接口为 `POST /v1/music_generation`，使用 Bearer API Key。文档有 `is_instrumental`、`lyrics_optimizer`、hex／URL 输出；URL 有效期为 24 小时。不能仅因 HTTP 200 就判断生成成功，必须检查 `base_resp` 并验证实际音频。[请求与响应规格](https://platform.minimax.io/docs/api-reference/music-generation)

官方也提供 MiniMax Music 3 自托管参考路径，通过 `POST /v1/audio/speech` 接收歌词与音乐描述、返回 WAV。它与 Hosted Music API 是不同协议；官方未发布完整生产硬件／性能基线，因此需要单独容量验证。[自托管参考](https://platform.minimax.io/docs/guides/local-deploy-music-3)

实施决策：

1. Hosted MiniMax 用现有付费资格账号进行一首歌曲和一段纯音乐的真实验证。平台配置记录验证时间、模型、协议、凭据版本与支持能力。
2. 验证通过后，XOPC Cloud 用户使用平台管理的上游凭据；用户只登录 XOPC，无需自己注册 MiniMax。还需核实账号服务范围是否覆盖平台提供的用途。
3. 平台没有调用资格时，该服务保持不可用，不把它标为 onboarding 默认音乐模型。采用另一个经过验证的上游，或单独评估 MiniMax 自托管。
4. MiniMax 自托管使用独立 adapter id；不能把 TTS URL 填进 Hosted MiniMax 配置就视为兼容。
5. 不推荐免费型号，不假定旧 `music-2.5`／`music-2.5+` 今天仍可用。模型 id 来自平台发布目录和 Provider 的验证记录。
6. 本轮没有使用真实凭据调用接口，调用资格、成本、音质、生成耗时尚未实测。

## 4. 用户路径与交互

### 4.1 从聊天开始

示例：“给我做一首关于周五下班的中文歌，轻松一点，吉他为主。”

Personal AI 从消息推导主题、语言、人声与风格。用户直接要求生成时，AI 可写词并执行生成；用户要求“先写词给我看看”时，先交付可编辑创作草稿，用户点击“生成音乐”后再发起付费任务。模糊缺项使用合理默认值，不连续追问音乐术语。

一键入口位于聊天输入区的能力菜单：“创作音乐”。打开草稿时保持当前 conversationId，与已有项目关联沿用现有机制。

草稿布局：

```text
创作音乐
歌曲                 纯音乐

想做什么样的音乐？
[给周五下班写一首轻松的中文歌，木吉他，温暖的人声]

歌词：AI 帮我写       使用我的歌词
[Verse] ...          ← 选择自定义时显示编辑区域
[Chorus] ...

高级选项 ▾           ← 模型允许时显示目标时长等选项
                     [生成音乐]
```

歌曲模式：“AI 帮我写”默认使用当前聊天模型写词，输出结构化段落后交给音乐模型；用户给了歌词则不悄悄改写。纯音乐模式不发送旧歌词，切回歌曲可恢复本地草稿。

MiniMax 等不具备精确时长控制的模型，不显示精确时长选择器。用户口述的时长可作为偏好写入描述，但结果展示实际时长，不声称精确遵循。

生成任务每次默认一份作品；不复制竞品“一次生成两首”的策略，避免隐含翻倍成本。再次生成是新的明确请求。

### 4.2 等待与失败

生成后立即展示任务卡，状态为“排队中”“正在生成”“正在保存”“可播放”。没有真实进度时不显示百分比；离开页面后任务仍继续，可在原对话恢复。

失败保留主题、歌词和高级选项，用户可以修改再试。额度不足显示补充额度入口；未配置显示音乐设置入口；服务权限错误显示可理解的服务不可用提示。内部 trace id 供诊断，原始响应和密钥不进入产品页面。

“取消”在排队阶段保证不执行；执行阶段表示请求停止，是否能停止上游计算及是否已计费取决于 Provider。网络超时不能自动重试付费生成；先查询原任务，再决定是否需要用户重新生成。

### 4.3 成品卡与播放

```text
周五的晚风                              AI 生成
中文 · 木吉他 · 轻松                      实际时长

[播放／暂停] ─────●──────── 00:38 / 实际时长

[查看歌词]       [再做一个版本]       [下载]
```

作品卡使用标题、实际时长、歌曲／纯音乐、必要风格信息；模型信息放到详情。第一版可用统一音乐图标，封面生成不是交付依赖。

点击播放加载已有鉴权媒体地址。支持暂停、拖动和下载；默认正常速度。音乐与现有语音／TTS 共用播放互斥协调，开始录音时暂停当前音频。

生成完成默认显示可播放状态。用户明确说“做完播放”且客户端存在允许播放的交互上下文时尝试播放；浏览器拒绝 autoplay 时保留播放按钮，不把它标记为生成失败。跨渠道不能承诺在用户设备自动响起。

同一音频只显示一份播放器。音乐作品卡渲染时 suppress 通用音频附件重复展示；普通语音消息仍保持现有外观。

歌词默认折叠，详情里可复制和编辑。没有真实歌词时间戳时不做逐字同步高亮，不用估算假装卡拉 OK。

### 4.4 修改、保存与视频复用

“把副歌写得更积极一点，再生成”生成子版本，保存 parentTrackId、这次使用的歌词与风格。第一版是重新生成整首，UI 明确表达；局部替换和续写只在未来模型真实支持时开放。

结果自动保存到作品存储并与对话关联，刷新后可恢复；下载原始音频。后续“我的音乐”按标题、时间和风格展示作品。用于视频时传递稳定 artifactId、音频 MIME、实际时长及媒体引用，视频制作流程再决定裁剪、淡入淡出与循环。

### 4.5 能力设置与 onboarding

建议新增 `#/settings/capabilities/music`，用户侧标签为“音乐”。区分：音乐生成、语音合成、语音识别、音频播放。

配置页面显示当前来源、默认模型、连接状态和模型支持能力。默认优先 XOPC Cloud；进阶用户可以选择 MiniMax 等自有 Provider。API Key 复用凭据管理，音乐模块不增加另一套明文存储。

XOPC 登录完成 → 刷新模型目录 → 查找 available 的 music + music.generate 模型 → 选择推荐项 → 只填充缺失音乐默认值 → 展示“试做一首歌”入口。

云端没有音乐模型时，其余 onboarding 继续完成，音乐显示“暂未提供”。不把音乐新增为现有聊天／图像／语音 onboarding 的强制门槛。不覆盖用户已经配置的音乐 Provider。

页面加载使用 Skeleton；选项使用项目 PopoverSelect；复杂编辑对话框外层固定响应式尺寸、内部滚动。沿用 `globals.css` 语义 token 和 [UI 设计系统](./ui-design-system.md)。

## 5. 当前代码与可复用链路

本次没有可调用的 codebase-memory-mcp 图谱工具，以下路径通过源码检索确认。xopc 工作区存在其他尚未提交的改动；本方案只新增文档。

| 现有能力 | 位置 | 音乐落地方式 |
| --- | --- | --- |
| Agent 默认／覆写模型 schema | `src/agent-config/schema.ts`、`resolver.ts` | 增加 musicGeneration，继承／null 禁用遵循 imageGeneration 模式 |
| 云端模型目录类型 | `src/providers/model-catalog-types.ts` | 增加 music kind、music.generate operation 和音乐 capability |
| 图像 Provider 与 runtime | `src/agent/image/generation/` | 借鉴注册表、模型选择、凭据与取消信号，不依赖图像类型 |
| 工具生成与附件交付 | `src/agent/tools/image-generate-tool.ts`、`tool-media.ts` | music_generate 返回音频媒体引用与作品信息 |
| 媒体持久化 | `src/media/store.ts`、`types.ts` | outbound bucket 存音频，转录中存 URI，不存 base64 |
| 鉴权音频读取、Range | `src/gateway/hono/routes/media.ts` | 复用 conversation／task scope 与 206／416 行为 |
| 音频附件播放 | `web/src/features/chat/composer/voice-message-bar.tsx` | 复用鉴权 fetch、Blob 生命周期及播放协调，新增音乐表现层 |
| 通用媒体预览 | `web/src/features/preview-runtime/plugins/media-plugins.tsx` | 保留音频文件预览与下载 |
| 云端能力自动配置 | `src/gateway/xopc-cloud-capability-setup.ts` | 音乐作为可选能力填充，不破坏旧目录 |
| 能力设置导航 | `web/src/features/settings/models-hub/capabilities-settings-panel.tsx` | 增加音乐面板及中英文文案 |
| 平台服务管理 | `apps/model-gateway/src/model-services.ts`、`model-service-routes.ts` | music 服务必须覆盖保存、验证、发布、启停和版本 |
| 平台能力解析 | `apps/model-gateway/src/model-capabilities.ts` | 增加 audio 输出、music operation，避免 parser 丢弃新能力 |
| 平台目录和调用入口 | `apps/model-gateway/src/app.ts` | `/models` 目录加入音乐；独立生成任务入口 |
| 平台服务 UI | `apps/console/web/src/pages/ModelServicesPage.tsx` | 复用服务管理，增加音乐类型与歌曲／纯音乐测试 |

平台路径相对于 `/Users/micjoyce/develop/github/xopc-platform`。实施时还须检查各功能目录更具体的本地指引。

注意：当前全局 Agent defaults 的管理通过 AgentCatalogRepository／Service，不能只修改旧 xopc.json 示例就认为运行时音乐默认值已生效。

## 6. 模型、Provider 与公共协议（拟新增）

以下为待实现的 xopc 契约，不是 OpenAI 标准接口，也不是 MiniMax 原生协议。

模型目录统一使用 `kind: music`、`input: [text]`、`output: [audio]`、`operations: [music.generate]`，推荐键 `recommended['music-generation']`。musicGeneration capability 声明：

```typescript
interface MusicGenerationCapabilities {
  vocals: boolean;
  instrumental: boolean;
  customLyrics: boolean;
  maxPromptCharacters: number;
  maxLyricsCharacters?: number;
  duration?: { minSeconds: number; maxSeconds: number; exact: boolean };
  outputFormats: Array<'mp3' | 'wav' | 'flac'>;
  streaming: boolean;
  cancellation: 'queued-only' | 'best-effort' | 'upstream';
}

interface MusicGenerationRequest {
  model: string;
  prompt: string;
  mode: 'song' | 'instrumental';
  lyrics?: string;
  durationSeconds?: number;
  outputFormat?: 'mp3' | 'wav' | 'flac';
}
```

Provider registry 提供 id、label、credentialMode、protocol、模型列表、每模型 capability、isConfigured、generateMusic。Hosted MiniMax、MiniMax 自托管和 XOPC Cloud 各自实现 adapter。后续服务接入通过新 adapter 或显式支持的协议，避免未经验证的“通用 OpenAI 兼容音乐”。

runtime 统一解析 provider/model、验证输入、解析凭据、管理 AbortSignal 和超时、规范化结果。规范结果包含音频、实际时长、实际 provider/model、traceId；不把上游 hex／URL 暴露给 LLM。

歌曲需要非空歌词（由 Agent 先写或用户提供）；纯音乐不得带歌词。超长输入返回明确错误，不静默截断歌词。模型不支持的硬需求在调用前拒绝或给出可选方案，不悄悄降级成另一种作品。

Agent 模型路由增加 `models.musicGeneration: { primary, fallbacks, timeoutMs? }`。Agent 覆写支持 null 禁用。默认不跨 Provider 自动回退；明确配置的 fallback 也须保持能力，并且不能在“上游可能成功但客户端超时”的情况下重新付费生成。

配置示意（通过现有 defaults 管理入口保存）：

```json
{
  "models": {
    "musicGeneration": {
      "primary": "xopc-cloud/music-standard",
      "fallbacks": [],
      "timeoutMs": 300000
    }
  }
}
```

`music-standard` 是拟定的稳定公共 ID；不是已发布模型。MiniMax 上游实际型号可在平台调整，不要求所有用户同时修改配置。300 秒是待实测调整的初始工程超时，不是生成时间承诺。

## 7. 持久化任务与作品

第一版使用持久化任务，Provider 同步返回也由 worker 执行。请求生命周期与聊天页面生命周期分离；不要把长耗时音乐生成绑在浏览器 HTTP 连接上。

```mermaid
flowchart LR
  A[用户描述或编辑草稿] --> B[Personal AI 整理风格与歌词]
  B --> C[持久化音乐任务]
  C --> D{模型来源}
  D --> E[自有 Provider]
  D --> F[XOPC Cloud 鉴权与额度]
  F --> G[已验证的音乐上游]
  E --> H[规范化并保存音频]
  G --> H
  H --> I[音乐作品与对话引用]
  I --> J[鉴权读取与播放]
  I --> K[下载或视频复用]
```

本地任务记录：jobId、conversationId、agentId、可选 projectId、发起者、idempotencyKey、输入快照、resolvedModel、状态、providerJobId、错误码、createdAt／updatedAt。

状态机：queued → running → saving → succeeded；另有 failed、cancelled、unknown。unknown 表示已提交上游但结果不确定，允许查询／人工重试，不当作安全自动重试依据。

作品记录：trackId、artifactId、jobId、conversationId、agentId、title、mode、prompt、lyrics、provider、model、实际 durationSeconds、mimeType、sizeBytes、稳定 mediaUri、parentTrackId、createdAt。生成输入按版本保存；播放状态不写入会话转录。

音频存 outbound media store；作品与任务元数据进入 SQLite migration／repository。转录只追加工具结果与作品引用，遵循现有 embedded turn 写入路径，不新增 turn-end SessionStore.save。

media scope 要在任务和对话引用保存成功后再暴露“可播放”。音乐列表也必须通过合法 task／conversation scope 读取；不能为了歌曲库新增任意 URI 读取权限。

若上游返回临时 URL，在成功前下载并持久化；限制响应大小、检查真实音频格式、使用既有受限网络下载机制。URL 到期不能导致已交付作品无法播放。存储失败单独保留可恢复状态，避免重生成音频。

重启恢复：排队任务重新调度；可查询上游任务继续查询；不支持查询且结果不确定的任务标为 unknown，不能盲目再调用。删除对话按既有作品保留策略处理引用；播放不会触发新生成或再次扣费。

## 8. Gateway API 与 Agent 工具（拟新增）

建议接口：

| 路径 | 用途 |
| --- | --- |
| `GET /api/music/providers` | Provider、模型能力与连接状态，无密钥 |
| `POST /api/music/jobs` | 传 conversationId、输入、idempotencyKey，快速返回 202 + jobId |
| `GET /api/music/jobs/:jobId` | 恢复状态；检查发起者及 conversation／agent scope |
| `POST /api/music/jobs/:jobId/cancel` | 请求取消，返回真实状态及能否停止上游 |
| `GET /api/music/tracks/:trackId` | 作品详情与受限媒体引用 |

生成默认值保存复用现有全局／Agent defaults 管理接口，不另造只在 UI 生效的配置。

`music_generate` 工具与产品创作按钮调用同一 application service。工具支持 prompt、mode、lyrics、title，以及经 capability 验证的可选参数；默认模型使用当前 Agent resolved config。创建任务后通过已有任务／实时机制交付完成结果，不能让 Agent 因等待而无限循环轮询。

完成结果包含 `details.media` 中的 audio MediaRef，并提供 kind=audio 的 artifact 与 music 语义元数据。若现有附件／artifact 契约无法承载音乐语义，应在共享契约中扩展，前后端一起更新；不要往普通语音转录字段硬塞歌词。

所有新增鉴权路由必须更新 `lazy-bundles.ts`、mapping 测试及真实鉴权 Gateway 验证；包括 job cancel 和参数化 track 路径。请求限制、取消和完成事件使用既有项目机制。

## 9. xopc-platform 云端配置与调用

### 9.1 管理员配置

在现有 Model Services 页面增加“音乐生成”服务类型：公共 ID、显示名、上游连接、协议、模型、定价单位、配额、优先级、支持能力。敏感凭据继续由服务端 Secrets／Provider 管理。

流程：保存草稿 → 用受控的短任务验证歌曲／纯音乐 → 显示验证结果和实际音频 → 发布 → 用户目录可见 → 可以设为音乐推荐模型。沿用 revision、凭据指纹、审计与启停；编辑未验证的草稿不能直接成为用户默认模型。

配置示意：公共 ID `music-standard`、显示名“音乐”、上游 `minimax-music-hosted`、模型 `music-3.0`。默认 disabled，直到真实付费账号验证通过。不要通过此次文档工作直接写生产密钥或发布服务。

平台服务 schema、Repository、模型目录、诊断、管理 UI、测试／验证入口均需增加 music 分支。不能只扩展服务 kind 枚举，否则 publish／计费逻辑可能把 music 当作 STT/TTS。

### 9.2 面向 xopc 的协议

拟采用 `POST /v1/music/generations` 创建任务、`GET /v1/music/generations/:id` 查询、`POST /v1/music/generations/:id/cancel` 请求取消；统一鉴权和 operation=`music.generate`。结果返回短期受控下载引用与音频元数据，由 xopc 下载保存到本地作品存储。

这些是 XOPC 自定义接口，需要版本化 contract 与输入限制；不能标记为 OpenAI 原生音乐 API。上游请求、返回编码、任务查询能力全部由 adapter 转换。

幂等键作用域至少包括 tenant、user、operation；同一 key 不同参数返回冲突，同一 key 同一参数返回原 job。任何 fallback 都不能越过额度、权限或重复生成边界。

### 9.3 额度、计费与文件

第一版建议以“成功生成的作品”为用户展示单位，具体每首价格由管理员配置并根据上游成本验证。若将来按时长计费，必须目录声明单位，前端据此展示，不能复用 tokens、characters 或 STT minutes。

提交任务原子预留额度；成功且音频已保存后结算一次；确定未生成的失败释放预留。超时未知状态待对账，重复查询、下载、任务重放不重复收费。取消实际成本与用户收费策略需配置明确。

任务与产物按租户／用户隔离，文件设置容量、存留和受控下载策略。平台作品保存与本地作品保存分工明确：云端任务结果保留可恢复窗口，本地下载完成后长期播放依赖本地稳定媒体。

### 9.4 目录与兼容

`/models` 目录返回 music 模型、operation、capability、可用性及独立音乐推荐项。现有 metadata parser、缓存／ETag、刷新与不可用模型处理一起扩展。

旧 xopc 客户端必须安全忽略未知 music kind；先检查旧 parser 的实际行为，必要时做 catalog schemaVersion／client feature 协商。新客户端面对旧平台没有音乐字段时，正常完成其余 onboarding。

上游服务被禁用后，新生成禁用；已下载作品仍可播放。默认模型消失时展示替换入口，不自动替换用户显式指定的自有音乐模型。

## 10. 实施顺序与验收

| 阶段 | xopc | xopc-platform | 完成标准 |
| --- | --- | --- | --- |
| A：契约与资格 | music schema、能力与模型路由设计 | 上游资格、歌曲／纯音乐真实探测；公共协议与计费单位 | 明确一个可商用运营的上游；模型与能力契约对齐 |
| B：生成链路 | registry、MiniMax／Cloud adapter、job／track 存储、music_generate | 服务配置、验证发布、任务 worker、产物、额度结算 | 幂等任务产生持久音频；失败／重启恢复可解释 |
| C：产品闭环 | 音乐设置、onboarding、草稿、任务卡、作品播放与下载 | 管理测试、目录推荐、运维诊断 | 新用户登录后可创作；无需接触上游 Key；刷新后可播放 |
| D：创作增强 | 我的音乐、版本比较、全局播放器、视频引用 | 第二 Provider、可选时长／编辑等能力 | 新 Provider 不改用户主流程；视频可复用音乐作品 |

A–C 是第一版的完整交付；D 是后续增强。跨页面持续播放必须单独决定导航和移动端行为，第一版页面离开可暂停。

必须验证的行为：

1. 歌曲与纯音乐参数分离、自定义歌词不被改写、字符限制与不支持的参数在付费调用前处理。
2. MiniMax HTTP 200 + 非零 base_resp、空音频、损坏 hex、错误 MIME、超限音频不会成为成功作品。
3. 断网／超时／重启不重复生成和扣费；保存失败可以恢复；取消不伪称上游已停止。
4. 同租户跨用户和跨会话越权均拒绝；task／conversation 媒体 scope 正确；Range、Blob 回收与 seek 正常。
5. 任务完成事件与重连后查询一致；刷新后标题、歌词、版本、播放地址恢复。
6. 音乐和语音／TTS 不重叠播放；浏览器拒绝 autoplay 不影响已生成状态；屏幕阅读器和键盘可操作。
7. 新平台配旧客户端、旧平台配新客户端兼容；音乐缺失不阻断已有 onboarding；不覆盖用户现有配置。
8. 发布验证、禁用、模型更新、额度不足、成功结算与幂等重放覆盖集成测试。
9. 真实 Gateway 的新增路径经过 lazy bundle 和鉴权访问，不能只有路由模块单测。
10. 有真实凭据时完成中文歌曲、纯音乐、下载后隔日播放的端到端验收；没有凭据时明确标记 live 验证未完成。

## 11. 仍需用实测解决的事项

平台是否已有 MiniMax 付费音乐资格；不同语言的唱词质量；歌曲／纯音乐真实耗时与峰值并发；单首成本与失败收费；自托管方案的硬件成本与生产可用性。现有资料不能代替这些数据。

第一版暂不包含声线克隆、模仿指定人物、翻唱、分轨、局部音频替换和精确歌词同步；这些功能各自需要 Provider 能力与交互设计。后续可沿用本方案的作品引用、版本和任务协议逐步扩展。

## 12. 修订：独立音乐能力与 Personal AI 快速对话

### 12.1 三层分工

音乐能力层统一管理 Provider、模型路由、生成任务、音频产物与作品版本；music_generate 对全部 Agent 可用，但执行依赖各 Agent resolved config、工具权限与用户额度。Personal AI 不拥有专属音乐后端，也不绕过其他 Agent 的权限策略。

音乐创作模块提供专门的歌词与风格编辑、作品列表、版本试听和下载。它直接调用同一能力层。用户可直接进入，也可从任意 Agent 交付的音乐作品打开；作品的稳定引用保持不变。

Personal AI 负责理解创作意图、合理补齐风格、自动写词、调用能力、交付作品和理解修改反馈。生成需要用到的偏好明确进入创作描述，不把完整对话历史自动作为音乐 Provider 输入。

### 12.2 快速对话默认路径

“给我做一首轻松的周五下班歌” → 简短回应 → 音乐生成状态 → 可播放作品卡。无需展开完整歌词编辑器、选择 Provider 或逐项填写参数。

作品卡保留播放／暂停／进度、歌词折叠、“再做一个版本”、“编辑作品”和下载。歌词与风格参数按需查看；点击“编辑作品”进入音乐创作模块并定位同一作品。

“节奏慢一点”“做个纯音乐版”“副歌更温暖”可以直接作为后续对话发起新版本。原作保留，第一版修改为重新生成整首，不暗示局部替换。再次生成会使用一个新的用户创作请求。

### 12.3 何时需要轻量确认

用户明确要求生成且意图足够时直接执行。用户说“想做一首歌，帮我想想”时先讨论方向；仅展示标题、歌曲／纯音乐与少量风格标签，提供“就按这个做”和“调整歌词与风格”。用户要求先看歌词时先交付歌词。

原型中的“直接创作”与“先确认方向”用于比较这两种对话节奏，不意味着所有用户都要经历确认步骤。默认推荐直接创作，确认用于意图尚未明确的场景。

### 12.4 模块入口与导航

音乐设置属于能力配置；音乐创作属于创作工作流，两者分开。原型展示了独立音乐入口以便评审模块形态；正式导航可先收纳到作品／创作入口，或从作品卡打开，避免每新增一种生成能力就增加一个顶级导航项。

首次使用从云端登录、音乐能力就绪到示例对话；模型配置仍由目录自动填充。进入音乐创作模块后，用户可以修改同一份主题、歌词、模式并生成新版本，结果可回到 Personal AI 对话继续讨论。
