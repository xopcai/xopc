# XOPC Cloud 公共模型服务方案

日期：2026-10-10。状态：云端公共服务与 i18n 已迁移并部署（提交 14ac999、68a5e30、3b046d3）；客户端启动迁移已实现、验证，尚未发布 npm。

发布策略：一次性切换。云端一次迁移后仅支持公共模型入口和原有 Codex；xopc 用户升级到最新版后，由启动迁移自动修复旧引用。不保留双目录、客户端版本分流或旧模型 ID 调用兼容。

## 目标与公共契约

对外展示稳定的产品服务，底层供应商模型只由云端运营管理。聊天保留两档，其他能力各一个入口，Codex 保持当前身份、授权、返回和计费方式。

| 能力 | 云端 model ID | 客户端引用 | kind | 默认 |
| --- | --- | --- | --- | --- |
| 聊天 | auto | xopc-cloud/auto | language | 是 |
| 高级聊天 | advanced | xopc-cloud/advanced | language | 否 |
| 图片生成/编辑 | image | xopc-cloud/image | image | 是 |
| 语音识别 | stt | xopc-cloud/stt | stt | 是 |
| 语音合成 | tts | xopc-cloud/tts | tts | 是 |
| 实时语音对话 | realtime | xopc-cloud/realtime | omni | 是 |
| 电脑操作 | computer | xopc-cloud/computer | language + computerUse | 专用设置选择 |
| Codex | 当前 ID | 当前引用 | 当前类型 | 当前规则 |

客户端 provider 为 xopc-cloud，云端请求仅携带表中的 model ID。保留内部 kind=omni，避免把对外命名调整扩大为协议类型迁移。图片生成和编辑通过 operation 区分。

电脑操作通过 computer 公共入口继续提供原 Computer Use · GUI-Plus Preview 服务，保持专用 profile、固定部署和现有价格/限额。它是独立专用能力，不进入普通聊天或普通视觉推荐。

## 现有代码与设计约束

- platform 的 model-services.ts 已提供 publicId、targets、发布版本、价格、限额和草稿验证。沿用它作为公共服务的权威配置。
- app.ts 的 /models 当前合并各协议仓库和 Codex，需改为输出产品目录；内部 ModelCatalog.byId 用于执行，只注册迁移后的可调用公共服务。
- 图片和 STT 已有多目标重试；TTS 当前使用首个目标。不能把公共命名改造描述成所有协议都已支持自动分发。
- 实时语音 schema 要求 publicId=targets[0].model，OmniRepository 只有 model/providerId，OmniRelay 用外部 modelId 构建上游 URL 和判断协议。必须解耦。
- xopc 的模型目录按 ID 去重。使用 image/stt/tts/realtime 后无须改为复合 key。
- 当前 Agent 默认是 deepseek/deepseek-flash；Agent 默认和覆盖已存 SQLite。旧版 agents 配置通过现有 cutover 导入。

## 公共服务配置与发布

保留固定的公共 ID 与能力归属。运营后台能修改目标、默认目标、优先级、价格、能力和音色映射，但不能把 stt 发布成 tts，也不能占用 Codex 保留命名空间。

在现有服务配置上增加以下概念，最终字段位置以实现时的 schema 设计为准：

- 固定公共 ID 注册表：决定允许发布和调用的产品入口及能力归属。底层模型留在供应商库存和 targets；本次不增加 legacy 可见性与执行模式。
- publicCapabilities：显式服务能力契约，发布时验证目标能够满足；不能直接透出首个目标或所有目标的无约束并集。
- 对 TTS/实时语音增加公共音色目录与目标音色映射。
- 对实时语音执行数据增加 upstreamModel，公共 model 保持 realtime。

公共 ID 只对应一个当前已发布服务。初次切换由发布迁移创建新公共服务并复制已发布配置；旧服务及草稿归档，不再发布或执行。若 ID 已存在但归属不符，阻止迁移并报告冲突。运营后台禁止创建其他对外产品 ID，但仍允许配置实际供应商模型。历史服务、调用与计费记录保留，运行路由移除旧入口。

一版先采用各协议已支持的固定/优先级路由。自适应选择独立迭代，不在此次命名迁移中为图片、音频开放目前不支持的 adaptive 配置。

## 各能力服务调整

### 聊天 auto / advanced

- 继续使用 ModelRepository、ModelCatalog 和当前聊天执行链。
- 目录只输出两个普通聊天产品服务；Codex 分支单独追加，专用 computer 模型单独分类。
- auto/advanced 分别绑定独立的已发布路由、价格和限额。不要在迁移时擅自更改现有 advanced 的产品定价或目标。
- auto 显式成为默认聊天入口，不依赖返回顺序或按名字排序。
- 路由按文本、视觉、工具、推理、协议等请求要求筛选实际目标。选不到兼容目标时明确失败。
- 同一次流式响应固定实际目标；已经向客户端输出内容后不自动切换目标重放。
- JSON 与流式响应中的 model 返回请求的公共 ID，底层身份保存在内部诊断。
- 文件：platform app.ts、model-services.ts、model-catalog.ts、adaptive-routing.ts、canonical-protocol.ts 及相关序列化代码。

### 电脑操作 computer

- 原服务 `computer-gui-plus-preview` 的已发布目标、密钥池、价格和限额迁移到 `computer`；旧服务归档。对外仅返回 `xopc-cloud/computer`。
- 目录保留 `capabilities.computerUse.profile` 和 `computerLimits`，客户端在 Computer Use 设置独立选择该服务。
- `computerDeployment` 对外仅保留不透明的 `revision`；不公开实际供应商、模型或上游 origin。客户端允许缺省 origin，仍将 revision 放入 `x-xopc-computer-deployment` 请求头。
- 执行时验证固定部署的 revision；目标或发布版本变化后返回 409，客户端重新拉取目录并打开会话。不取消版本校验，也不对 GUI 操作自动换目标重放。
- 客户端升级将 `computerUse` 模型字段以及旧云端 `computer-gui-plus-preview` / `gui-plus-2026-02-26` 引用迁移到 `xopc-cloud/computer`；提示词、历史正文与第三方模型引用保持原样。

### 图片 image

- 创建 publicId=image 的图片服务，保留 ImageRepository 目标与现有计费预留/结算。
- 图片生成和编辑接口均接受 image；先校验公共契约，再按操作、尺寸、参考图数量等筛选目标。
- 首版可沿用当前目标能力一致的发布限制，不必同时开放异构目标。后续开放时需要显式能力契约和逐请求目标过滤。
- 所有兼容目标按优先级执行，沿用有界重试；超时但执行结果未知时避免无条件重试造成重复生成和上游费用。
- 目录只返回 image 的格式、尺寸、操作和限制，不返回真实模型、路由或供应商。
- 文件：platform model-services.ts、image-repository.ts、openai-images.ts、image-upstream.ts、app.ts 图片执行段。

### STT stt

- 创建 publicId=stt 的识别服务，HTTP 和实时识别使用同一产品身份；仅声明实际提供的 modes。
- 保留 AudioRepository 和现有优先级重试，按输入格式、时长、语言、时间戳、说话人分离要求筛选目标。
- 服务声明稳定的格式与时长边界。需要转换输入时由云端执行，不能把供应商差异交给客户端。
- 实时识别沿用已有 ticket/目标绑定机制；流建立后目标固定，不重放客户端已经提交的音频。
- 价格按公共 STT 服务计费，内部记录实际供应商与模型。
- 文件：platform audio-repository.ts、openai-audio.ts、audio-upstream.ts、realtime-audio-relay.ts、app.ts。

### TTS tts

- 创建 publicId=tts 的合成服务，使用公共 voice ID，例如 default；运营可增加稳定音色名称，但不要求初版固定某组尚未验证的音色。
- GET /audio/voices?model=tts 返回公共音色目录；voice manifest、defaultVoice 和 HTTP 校验均引用公共音色。
- 每个目标配置 publicVoice -> upstreamVoice 映射。没有所选音色映射的目标不可作为 fallback。
- 按格式、音色、语言、速度、指令能力筛选目标。音频输出前允许有界重试，输出后不自动拼接另一目标音频。
- 当前首目标执行改为可验证的优先级策略；如果本期不实现多目标，发布验证限制一个目标，避免后台显示虚假备用能力。
- 迁移旧音色时使用明确映射；无法等价映射时记录变更并选择公共默认音色，不能静默宣称完全等价。
- 文件：platform model-services.ts、audio-repository.ts、audio-upstream.ts、openai-audio.ts、realtime-audio-relay.ts、app.ts 音色与合成路由。

### 实时语音 realtime

- publicId=realtime，内部 kind=omni。移除 publicId 必须等于真实模型的限制，首版仍保持一个目标。
- OmniRepository 显式保存公共 model 和 upstreamModel；从现有 model 值回填 upstreamModel，建立 realtime 入口并停用旧入口。历史记录仅用于审计和结算。
- ModelServices.materialize 写入 targets[0].model，不能仅保留 providerId。
- OmniRelay 使用公共 ID 做授权、ticket 校验、配额、版本校验和产品计费；使用 upstreamModel 构建 URL、识别协议、转换音频和初始化上游会话。
- 客户端会话事件中的模型、嵌套转写模型、音色和错误需要在协议边界规范化，不能仅替换顶层字段。
- 调用记录保存公共 ID、实际目标、上游模型、密钥/池引用和服务版本。修复当前 providerModel 取公共 model 的路径。
- 活跃会话固定目标和计费快照；运营发布新版本只影响新会话。旧版本 ticket 的失效行为保留当前显式版本冲突机制。
- 多目标选择放后续阶段，并保持会话建立后固定目标，不在此次改造中承诺不中断故障切换。
- 文件：platform model-services.ts、omni-repository.ts、omni-relay.ts、index.ts 的升级入口及 ticket/manifest 相关代码。

### Codex

现有目录追加、授权、共享访问判定、专用请求分支与计费方式保持原行为。新目录过滤、响应模型规范化和旧引用迁移必须明确排除 Codex，不能只按 provider=xopc-cloud 批量替换。

## 产品目录与对外返回

目录依旧是 OpenAI 风格 data[]，每个产品有唯一 ID、名称、kind、operations、公共能力和必要的 voice manifest。返回产品服务版本与明确的能力默认值。普通聊天推荐明确为 auto；视觉推荐只在 auto 服务满足视觉契约时指向 auto，否则选可用的 advanced 或不提供。

能力推荐按可用能力分别返回，避免目前只有视觉、图片、STT、TTS 全部齐全才发 defaults 的限制。云端仅提供一套产品目录，不根据客户端版本或请求头返回不同目录。目录带 schemaVersion 用于结构校验和缓存失效，不用于旧版分流。

产品目录与内部供应商库存分离：供应商实际模型保留在库存和 targets，执行 catalog 只加载允许调用的公共服务。HTTP、WebSocket、ticket 和测试执行路径均校验公共 ID，避免仅隐藏目录却仍允许旧模型调用。目录版本包含公共产品、发布版本、能力/音色版本和 Codex 用户访问版本；可见性变化也要导致版本变化。

普通客户端只看到公共模型、公共能力、价格/档位、公共音色和 requestId。真实模型、provider、路由 profile、computer deployment 内部信息及上游错误留在受权运营后台。HTTP、SSE、WebSocket 分别做结构化规范化；保留必要的协议行为，不对响应内容做全局字符串替换。

工作区授权按公共产品执行，同时保留已有租户隔离与目标可用性检查。迁移工作区模型 allowlist/denylist 时显式处理旧 ID；存在冲突时采用不扩大权限的策略并要求运营处理，不能把所有历史模型授权无条件合并成一个新权限。

## 运营后台与控制台

- ModelServicesPage 展示公共服务入口及发布状态；公共 ID/类型在创建和已发布后受约束。
- 内部供应商模型仍在连接库存和 target picker 中完整展示，只对有权限的运营者开放。
- 编辑页区分公共服务能力、实际目标能力、公共音色和目标映射；发布前检查契约、至少一个可执行目标和价格/限额。
- 现有批量发布、验证 fingerprint、草稿 revision、测试调用、诊断和审计继续沿用。
- 用户侧使用量显示公共产品，运营诊断保留实际模型和服务版本；退款/补结算按调用快照执行。
- 文件：platform packages/shared/src/model-services.ts、apps/console/web/src/pages/ModelServicesPage.ts、MediaProviderEditor.tsx、ProviderConnectionsPage.tsx、console server 的 model-proxy.ts/billing-routes.ts。

## xopc 客户端调整

- XopcCloudModelSource 解析产品目录；显式读取 auto 推荐和各能力默认值。使用现有唯一 ID 缓存结构。
- 聊天选择器显示 auto/advanced 与原有 Codex；图片/STT/TTS/实时语音每种能力仅一个云端选项。
- 实时语音模型以 realtime 保存，仍按 kind=omni 和 voice modes 分派协议，不能通过模型名判断供应商。
- 新安装 Agent 默认改为 xopc-cloud/auto。未授权时进入现有连接引导，不能把授权缺失当作模型不存在。
- 授权成功并取得目录后验证公共入口；已有第三方供应商配置保持用户选择。新用户 onboarding 明确选 auto。
- 模型审计扩展 STT/TTS/实时语音和任务引用范围，并按能力给出建议，不能把图片或语音缺项建议成 auto。
- 重读目录与迁移后刷新 registry、图片 provider、voice 配置、Agent catalog 与会话内存；前端重验证对应缓存。
- 文件：xopc src/providers/xopc-cloud-model-source.ts、model-catalog-store.ts、model-catalog-persistence.ts、model-reference-auditor.ts；src/agent-config/schema.ts；src/config/voice.ts；web onboarding、models-hub 和 chat model selector。

## 升级迁移

### 云端

采用带版本的幂等应用迁移，创建缺失的公共服务，读取已发布配置而非草稿。已有 auto/advanced 保留。图片、STT、TTS、实时语音分别选明确的现网已发布服务作为种子，不能靠数据库顺序；选择与冲突形成运营预检结果。

云端切换在一次维护窗口完成：

1. 预检公共服务种子、ID 冲突、目标、能力、音色、价格和工作区权限；在写入前发现并解决缺失配置。
2. 备份数据库和服务配置，停止接收新调用，等待进行中的调用完成；实时会话到截止点明确关闭，保留已产生用量和待结算快照。
3. 在事务中创建/确认公共服务及目标、迁移工作区权限、回填 upstreamModel、归档旧服务和草稿、停用旧执行入口，写迁移标记。
4. 新服务完成认证 HTTP/WebSocket 冒烟验证后恢复流量。迁移或验证失败时不开放部分迁移的状态。

不重写历史调用、计费、待结算记录中的模型名称。旧运行路由不再可调用；为有外键引用的旧记录保留禁用行，其他记录按归档策略保留，不要求物理删除。新增数据库字段测试 SQLite/部署数据库适配层。

旧模型 ID 请求返回明确的 model_retired 错误与“升级 xopc 到最新版本”提示；这是错误说明，不解析到新服务。Codex 和第三方授权不受本次退场影响。云端迁移不等待所有客户端升级。

### 客户端

迁移 ID 示例：xopc-cloud-product-models-v1。用户升级后首次启动，在 Agent 初始化、会话恢复和任务调度前自动运行：先完成现有旧 JSON Agent -> SQLite cutover，再执行本迁移。不要求用户重新授权、重新选择模型或手动刷新目录。

迁移规则随新版内置，覆盖现网全部旧云端产品 ID、已退场历史 ID 和旧音色映射；云端发布预检导出清单，用于确认客户端映射完整。依据明确旧 ID 到能力的映射替换：普通云端聊天 -> auto，图片 -> image，STT -> stt，TTS -> tts，实时语音 -> realtime。auto/advanced/Codex/第三方供应商引用保留。未知引用结合能力字段识别并记录；不能因请求失败或目录缺项猜测迁移，也不能把未识别引用默默计为迁移成功。

覆盖 AgentCatalog 全局默认和独立覆盖、chat/intents/imageUnderstanding/imageGeneration、session_config.model_override、语音设置、工作流直接引用和自动化覆盖。fallback 去重并去除与 primary 相同的引用，保留顺序。电脑操作按专用策略单独处理。

DB 修改在事务中完成并更新 revision。xopc.json 等文件使用备份与原子写，跨 DB/文件迁移通过 application_migrations 阶段状态恢复，不能假设二者同一事务。迁移记录旧值与新值，重启恢复必须防止覆盖用户迁移后修改。

目录缓存纳入 schemaVersion：新版启动迁移作废旧云端缓存并拉取新目录，迁移配置本身不依赖联网。旧缓存保留备份但不重新注册为可用模型。离线或授权失效时配置迁移仍可完成，能力处于未就绪状态，联网/授权恢复后自动获取新目录。运行前要保证公共目录已就绪，避免旧缓存仍显示真实模型或首轮使用尚未加载的 auto。

## 显示名称与 i18n

模型在 `/v1/models` 的 `xopc.displayNames` 返回 `zh-CN` / `en`，原 `displayName` 保留作为回退名称。音色在 voice manifest 和 `/v1/audio/voices` 的条目上返回 `displayNames`，默认音色 ID 始终为 `default`。

| 服务 | 中文名称 | 英文名称 |
| --- | --- | --- |
| image | XOPC 云端图片 | XOPC Cloud Image |
| stt | XOPC 云端语音识别 | XOPC Cloud Transcription |
| tts | XOPC 云端语音合成 | XOPC Cloud Speech |
| realtime | XOPC 云端实时语音 | XOPC Cloud Realtime |
| computer | XOPC 云端电脑操作 | XOPC Cloud Computer |
| 默认音色 | 默认音色 | Default voice |

Gateway 语音目录保留翻译字段，界面在渲染时按当前语言选取名称；切换语言不需要重新拉取目录。缺少翻译时回退 `name`，本地配置与调用始终保存稳定 ID。云端补充名称作为新发布修订，保留已有自定义翻译和未发布草稿的路由修改。

## 实施与一次性发布

开发和验证可分步骤，生产切换只有一次：

1. 两仓库完成公共契约、六个入口、实时语音解耦、公共音色、响应规范化，以及客户端离线迁移/缓存失效/启动顺序。
2. 以云端旧数据导出和客户端旧配置样本完成端到端升级演练，确认全部历史模型映射覆盖、权限和计费正确。
3. 先发布可下载的 xopc 最新版；随后在同一发布窗口进行云端备份、停流、一次迁移、验证与恢复。新客户端在云端切换完成前显示服务升级状态并允许重试，不退回真实模型调用。
4. 通知用户升级一次即可；云端恢复后只提供新目录和新入口，不建设后续兼容退场阶段。

旧版 xopc 在云端切换后使用旧模型可能失败，这是本次发布接受的行为。已经使用 auto/advanced 或 Codex 的调用按新服务可用性处理；不承诺旧版客户端整体功能可用。最新版必须自动迁移持久配置并失效目录缓存，用户不应通过手动改配置恢复。

关键验收：

- 每个可用非 Codex 能力只返回一个条目，普通聊天恰好 auto/advanced；停用、未发布、工作区无权的服务不作为可用选项。
- Codex 目录、共享访问、流式调用与计费回归通过。
- 各 HTTP/SSE/WS 响应无真实模型或供应商元数据；运营诊断仍能追溯实际目标。
- realtime 实际上游接到原模型，协议分支和音频转换正确，公共 ID 不影响 ticket 与结算。
- TTS 公共音色在首选/备用目标可解析；音频输出后不切换目标。
- 升级覆盖旧 Agent、固定会话、语音设置、工作流与自动化；重复执行、离线、授权失效、各阶段崩溃可恢复。
- 工作区模型限制不因公共别名迁移而扩大权限；未发布草稿归档可追溯。
- 旧目录和旧 ID 在云端切换后不再可用；HTTP、ticket 和 WebSocket 路径均无兼容绕过，错误提示指向升级。
- 最新版首次启动无须用户手动改配置、重选模型或刷新缓存；联网后首轮聊天与各能力可用。
- 通过运行服务的真实认证接口及 WebSocket 验证，不只测试目录构造函数。

## 回滚

上线前保留数据库及服务配置备份。开放流量前失败，可在维护窗口恢复备份并保持升级状态；已经迁移的最新客户端等待云端恢复公共入口，不恢复真实模型调用。开放流量后优先修复或回滚服务目标/发布快照，继续保留新公共 ID，禁止恢复整库丢失新用量和计费数据。客户端备份用于故障恢复，按迁移日志和当前值检查反向修改，防止覆盖用户新设置。以上恢复措施不构成旧客户端兼容层。

## 参考

- OpenRouter 公共自动路由：https://openrouter.ai/docs/guides/routing/routers/auto-router
- Cloudflare 命名动态路由：https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/
- LiteLLM 公共别名与实际部署：https://docs.litellm.ai/docs/routing

## 实施与验收记录

- 云端提交：`14ac999`，已推送 xopc-platform main 并部署。部署前在生产 SQLite 副本演练迁移、重复运行验证幂等，停机后执行正式备份与迁移。
- 公网目录仅返回 7 个公共服务及原有 Codex，默认 chat/vision=auto、image-generation=image、stt=stt、tts=tts。
- 旧聊天模型调用返回 410；TTS HTTP 生成成功；STT、TTS、实时对话公共 WebSocket 均完成会话配置。实时对话服务返回的 model/voice 已转换为 realtime/default。
- 阿里云首选：STT HTTP `qwen-audio-3.1-asr-flash`、WS `qwen-audio-3.1-asr-flash-streaming`；TTS HTTP `qwen-audio-3.0-tts-plus`、WS `qwen3-tts-instruct-flash-realtime`；实时对话 `qwen3.8-omni-flash-realtime`。现有密钥连接验证通过。
- 客户端新增 `src/migrations/cloud-public-models.ts`，在应用启动、严格加载配置之前运行，备份 JSON/SQLite、转换旧引用、清除旧目录缓存并写入一次性完成标记。工作流通过现有 Catalog 保存为新修订；历史修订与会话正文保持原样。
- 客户端专项测试 29 项通过，TypeScript 检查通过。云端专项测试、控制台测试通过；全量测试中的 2 个并行超时用单 worker 重跑通过。
- i18n 补充：云端提交 `68a5e30`，公共能力名称通过 `xopc.displayNames` 返回 `zh-CN`/`en`，音色通过 `displayNames` 返回“默认音色 / Default voice”。客户端透传元数据，按界面语言在渲染时选择名称，缺少翻译时回退 `name`，调用 ID 不变。线上目录和音色接口验证通过。
- Computer Use 修复：云端提交 `3b046d3` 已部署，目录返回不透明部署 revision；客户端允许不返回上游 origin。真实认证接口验证：缺失 revision 返回 409，带正确 revision 的 `computer` 请求返回 200，GUI-Plus 正确识别合成图片中的蓝色矩形，响应 model 为 `computer`。客户端专项测试、云端 Gateway 请求测试、类型检查与客户端构建通过。
- 客户端尚未发版；用户升级到包含本次实现的新版本后，首次启动自动迁移。
