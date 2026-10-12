# Provider 快速配置技术调研

调研日期：2026-10-13。状态：技术方案，未实现。范围：OpenAI API Key、阿里云百炼按量付费；图像与语音作为第二阶段。未使用真实用户凭证进行接口验证。

## 结论

采用“供应商连接 + 自动模型目录 + 按能力选择默认值”。用户连接一次供应商，Key 只保存一次，模型目录和能力适配由系统生成。保留现有 pi 调用链、模型引用和高级配置入口。

OpenAI 常规连接只需 API Key；阿里云需 API Key 与地域，在原生目录接口要求时补充业务空间 ID。不要承诺只凭 Key 自动判断地域或所有模型均有调用权限。

先完成文本模型快速配置，再接入共享凭证的图像、STT、TTS、实时语音。通用目录发现不能直接代替多模态协议适配。

## 仓库现状与具体缺口

本次会话未提供 codebase-memory 图工具，代码发现回退到文件检索与源码阅读。

| 位置 | 已有能力 | 缺口 |
| --- | --- | --- |
| `src/providers/index.ts` | provider 级凭证与模型注册；一把 Key 可用于该 provider 多个模型 | `getAvailableModels` 主要按 provider 是否有凭证筛选，不是逐模型调用权限验证 |
| `src/auth/credentials.ts` | Agent 私有、全局、OAuth、环境变量解析；已有 auth profile | 新流程应复用凭证库；连接元信息与密钥需要分开 |
| `src/providers/domestic-presets.ts` | 阿里云国内/国际地址、默认模型和静态候选 | 阿里云目前以地域 provider 预设呈现，候选范围需要补充动态目录 |
| `web/src/features/settings/models-hub/add-provider-dialog.tsx` | 内置 provider 保存 Key；自定义 provider 有预设与发现按钮 | 阿里云预设进入自定义配置表单，暴露 provider ID、协议、Base URL、模型列表；自定义 Key 写入 `models.json` |
| `src/providers/model-discovery.ts` | OpenAI 兼容 `GET baseUrl/models` | 只读 `data[].id`，结果默认文本；不支持阿里原生响应和分页 |
| `src/providers/model-catalog-sync-service.ts` | 启用发现的自定义源可刷新、缓存目录 | 发现时直接使用 `provider.apiKey`；模型统一设为 language、text、非 reasoning、128K；需统一凭证解析并正确合并元数据 |
| `src/providers/model-catalog-types.ts` | 已有 language/image/stt/tts/omni、operations 和能力描述 | 可复用模型类型；源级单一 baseUrl/API 无法完整描述供应商跨能力路由 |
| `packages/image-providers/src/catalog.ts`、`src/voice/` | 已有 OpenAI、DashScope 图像与阿里云语音适配 | 阿里文本为 `dashscope-cn/intl`、图像为 `dashscope`、语音为 `alibaba`；需共享连接与地域映射 |

实时语音 `src/voice/realtime/omniRoute.ts` 已回退到 `dashscope` 凭证；因此凭证复用已有部分基础，但不能把它等同于文本地域 provider 的凭证已经全能力互通。

## 官方接口核对

### OpenAI

`GET https://api.openai.com/v1/models` 使用 Bearer API Key，返回模型 ID、归属和基础可用信息，并可包含停用日期；不提供完整上下文、工具调用和模态定义。动态 ID 应与 pi/维护目录中的已知元数据合并。未知模型显示“能力待确认”，不直接进入 Agent 推荐列表。[List models](https://developers.openai.com/api/reference/resources/models/methods/list)

目录读取与模型调用受权限约束；目录读取失败不应直接判定 Key 无效，需要区分 401、403、网络失败和无目录权限。[OpenAI RBAC](https://developers.openai.com/api/docs/guides/rbac)

本方案针对平台 API Key；现有 ChatGPT OAuth 继续使用自己的认证及目录流程，不把订阅授权投射到图像、语音 API。

### 阿里云百炼

普通百炼 Key 可覆盖同一授权范围内的文本、图像和语音模型；地域之间的 Key 不互通，业务空间和自定义模型权限会限制实际调用。[API Key 文档](https://help.aliyun.com/zh/model-studio/get-api-key)

原生 `GET /api/v1/models` 支持模态/能力筛选、上下文与定价信息，采用分页；北京文档地址要求 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com`，新加坡文档列出共享地址。应按官方地域表建立独立 discovery endpoint，不能从 OpenAI 兼容 Base URL 简单拼接推导。[查询模型列表](https://help.aliyun.com/zh/model-studio/list-models)

调用域名可为共享域名或业务空间专属域名；后者推荐用于生产。Token Plan/Coding Plan 使用专属 Key 和地址，文档限制为 AI 工具交互式使用，不能作为 xopc 后台自动任务的通用供应商连接。首期默认按量付费，套餐接入单独评估。[Base URL 总览](https://help.aliyun.com/zh/model-studio/base-url)

上述目录字段是模型说明，不能直接当作当前 Key 已获授权的证明。无需因目录中存在第三方模型就创建第三方凭证：通过百炼调用的模型仍归属于百炼连接，模型作者作为展示元数据。

## 方案比较

| 方案 | 收益 | 限制 | 决策 |
| --- | --- | --- | --- |
| 仅隐藏字段、使用静态预设 | 改动小，快速改善表单 | 目录老化，多能力凭证仍分散 | 作为第一阶段降级路径 |
| 供应商连接 + 动态目录 + 元数据合并 | 一次连接、多模型、可扩展到图像语音 | 需供应商发现适配和配置协调 | 推荐 |
| 增加 LiteLLM 等统一代理 | 可统一大量调用协议 | 引入部署、运维与密钥边界；现有调用层已有适配 | 当前需求不引入 |

## 用户流程

1. 选择 OpenAI 或阿里云百炼；阿里云选择 Key 所在地域，默认展示北京但不能从界面语言认定地域。
2. 输入 Key；地域原生目录要求业务空间时，展示业务空间 ID 字段。Base URL、协议和 provider ID 放到高级设置。
3. 后端验证连接并读取目录，展示推荐模型与“全部模型”。区分连接成功、目录刷新失败、模型待验证。
4. 默认推荐一个 Agent 可用的聊天模型；用户点击完成时应用。已有默认模型保留，提供“替换默认模型”选项。
5. 第二阶段展示“图像生成、语音输入、语音输出”等能力开关，展示已有配置与将应用的默认值；已配置能力不自动覆盖。

模型无需逐个添加，推荐页只展示少量候选，全部目录可搜索。六个模型 intents 保留为高级设置；未设置的 intent 如何回退必须按现有解析规则执行，禁止通过初始化批量覆盖已有 intent。

## 技术设计

### 连接身份与凭证

区分供应商品牌、运行时 provider ID、具体连接。新增最小 `ProviderConnection` 元信息：`id`、`vendor`、`runtimeProviderId`、`region?`、`workspaceId?`、`billingMode`、`credentialProfileId`、`endpointOverrides?`。密钥仍存 auth profile，元信息不存原始 Key。

第一阶段只允许每个现有 runtime provider 一个活动连接，沿用 `openai/<id>`、`dashscope-cn/<id>`、`dashscope-intl/<id>`，不重写会话或工作流。多账户、多地域连接的同一模型身份在后续单独设计，不能在尚未支持 connection ID 路由时假装已支持。

明确引用同一个 credential profile 共享 Key；不要向 `dashscope`、`alibaba` 等重复写入密钥，也不要根据品牌盲目回退到其他地域 Key。旧配置中不同 Key 保留为独立覆盖。环境变量继承保留，但新连接地域须明确；兼容性处理不扩大跨地域回退。

统一发现与推理的有效凭证解析，保持已有 Agent 私有/global/OAuth/env 语义；旧 `models.json` Key 作为兼容来源，新连接只写凭证库。同步取 Key 的路径需要失效与预热机制，避免保存后目录能访问、推理仍拿旧凭证。

### 供应商描述与发现适配

建立供应商描述，包含：地域/计费模式、发现策略、各能力 endpoint、支持的 runtime adapter 和推荐规则。推荐规则使用可维护目录，不在 UI 写死“最新型号”。

发现适配包含 `OpenAiModelDiscovery` 和 `DashScopeModelDiscovery`。前者复用现有 `/models`；后者处理 `/api/v1/models` 的分页与原生字段。能力运行时继续调用现有文本、图像、语音模块。

目录合并规则：人工 override 优先；已知供应商动态元数据与维护目录按字段来源合并；pi 提供已有文本能力；未知字段保持 unknown。未知模型不直接填入 128K 或 0 成本并向用户展示为已确认信息。只把能被当前 runtime adapter 执行的模型加入相应选择器。

分开存储 `credentialStatus`、`catalogStatus` 与模型 operation 的验证结果。读取目录成功不等同图像/语音调用成功。模型验证结果按连接、模型、operation 与凭证版本隔离，并带时间；401/403、限流、余额不足、协议不支持分别处理。

### 多能力投影

一个连接生成多个能力路由：文本 HTTP、图像原生接口、STT/TTS HTTP 或 WebSocket、实时语音 WebSocket。共享的是连接与凭证，不是同一个 URL 和协议。

扩展现有 catalog/source 表达或在连接描述层增加 operation route，避免复制另一份模型目录。Agent 视觉理解与图像生成分别匹配能力；实时语音不能由“有 STT 和 TTS”推断可用。

### 配置提交与刷新

增加 setup 协调服务：准备配置变更 → 验证/发现 → 保存凭证与连接 → 保存默认模型/选定能力 → 刷新目录与运行时 → 返回状态。前端、CLI 共用此服务。

目录刷新使用连接凭证；缓存按连接与地域分区。设置 TTL、并发去重、退避和最近成功快照。刷新失败保留旧目录；换 Key 后保留目录信息但清除旧授权验证结果；刷新不自动改默认模型。

跨凭证文件、配置文件和目录存储不是一个数据库事务，需要明确补偿及崩溃恢复：配置提交版本、暂存记录、失败恢复上个 profile。复用现有 image setup 的回滚思路，但不把它称为完整事务。

接口草案：`POST /api/provider-connections/preview` 返回目录与拟应用配置；`POST /api/provider-connections/setup` 提交连接和选定默认值；`POST /api/provider-connections/:id/refresh` 刷新。草案并非现有 API。后端保存 preview 的短期记录，返回 opaque ID，提交时核对配置版本；不让前端持有含密钥的长期 plan。

新认证路由必须同步更新 `lazy-bundles.ts` 及映射测试，通过真实认证 Gateway 验证可达性。发现使用供应商许可域名，沿用项目自定义 endpoint 的网络限制；日志只记录身份、阶段和错误类别。

## 分阶段落地

### 第一阶段：OpenAI、百炼文本快速配置

- 增加供应商快捷入口，把阿里云从通用自定义表单分流。
- Key 存凭证库；发现与推理统一解析。
- 接入 OpenAI 目录和百炼原生分页目录，保留静态预设降级。
- 目录合并、推荐默认模型、连接状态和立即生效。
- 未提供 Workspace ID 或目录受限时，允许使用维护候选完成聊天配置，显示“目录未同步”；不把静态候选标为授权已验证。

### 第二阶段：图像与语音一次配置

- 为现有图像、STT、TTS、实时语音绑定共享连接。
- 按地域生成 endpoint；逐项检查 adapter 是否支持该地域/业务空间域名。特别审查 `omniRoute.ts` 当前域名白名单，不能只改配置地址。
- 配置预览中展示能力变更；只应用用户选中的能力。
- 使用 operation 级验证状态，不承诺“一次认证全部能力可用”。

### 第三阶段：更多供应商与多账户

复用连接描述与 setup 服务扩展供应商。多账户引入 connection 级路由及引用规则；迁移通过显式映射进行，不解析旧会话 ID 或按品牌合并现有凭证。

## 验收与待验证事项

1. 新用户 OpenAI 常规配置只填 Key；阿里云填 Key、地域，目录需要时填业务空间。无手填协议和模型 ID。
2. 一次配置显示多个模型；推荐模型能通过真实推理流输出；换模型不再次输入 Key。
3. 已有默认值、Agent override、intents、工作流及手工模型元数据保留。
4. 403 目录受限、错误地域、模型无权限、限流、离线、分页失败、Key 轮换均有独立状态，失败不留下部分默认配置。
5. 已知视觉模型刷新后保留 image input；非聊天模型不进入聊天列表；未知上下文与价格显示未知。
6. 第二阶段同一连接驱动图像/STT/TTS，不重复持久化 Key，地域不串用；现有独立能力覆盖保留。
7. 验证 setup/refresh 的单元与集成行为、保存失败恢复、真实 Gateway lazy route 与 Web 流程；实际调用只对指定测试模型执行，不批量探测全部目录。

实施前需要使用测试账户验证：百炼各目标地域原生目录权限及具体响应字段；目录是否含不可调用模型；工具调用/流式/思考参数；各多模态 adapter 对工作空间域名的支持；目录无权限时可用的无计费验证路径。当前调研已核对代码和官方文档，未做真实 Key 测试，因此不将接口文档能力视为上线验证完成。
