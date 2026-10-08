# 中国用户内置 Connector：第二批候选

调研日期：2026-10-08。第一批高德、腾讯文档、语雀、百炼联网搜索已加入内置目录。用户进一步明确：本轮只补**用户以个人身份直接授权或自行配置的 MCP**。本文已按此条件重排；第二批已加入滴答清单、flomo、12306 社区查询和 AntV 图表的目录模板及图标；真实账号与业务调用待验证。国内候选以用户指定的 [魔搭 MCP 广场](https://www.modelscope.cn/mcp) 为补充入口。

筛选条件：个人用户能自助注册、授权或获取凭据并完成配置；无需企业/商户资格或商务申请。连接个人应用数据、个人可申请的 API 服务以及免凭据公共查询工具均可纳入。个人会员、实名、创建开发者应用和服务配额属于配置门槛，需如实标注。是否有 API Key 或 Hosted 标签不足以证明可用，还要核实个人获取资格、服务契约和实际权限。

## 1. 建议

本轮补齐 **滴答清单、flomo、12306 社区查询、AntV 图表**，分别覆盖个人任务、笔记、出行查询和规划可视化。现有腾讯文档、语雀、高德、百炼继续组成工作、生活、出行和规划的能力组合。

这轮优先级基于新增场景价值、官方身份、接入门槛和现有 xopc 模板适配程度，不是用户需求量统计。

| 顺序 | 候选 | 工作 / 生活 / 出行 / 规划场景 | 首版建议 | 接入判断 |
| --- | --- | --- | --- | --- |
| 1 | 滴答清单 | 工作待办、家庭事项、学习计划、习惯复盘 | 查任务、创建任务、完成任务、查习惯/专注记录 | 官方国内远程 MCP；Bearer API 口令可沿用现有安全存储，优先 |
| 2 | flomo | 工作思考、生活记录、长期复盘 | 搜索/读取笔记、保存想法、整理标签 | 官方 remote MCP；账号设置中创建个人 Token；需 Max 会员，已加入目录 |
| 待核实 | 快递100 | 包裹查询、寄件价格和到达时间估算 | 物流 API 查询 | 开放平台 API Key；个人申请资格和套餐仍需核实，不自动读取购物订单 |
| 3 | 12306 查询 | 差旅、周末旅游、直达/中转比较 | 公共余票查询 | 免凭据社区查询工具；已加入 experimental 目录，不读取个人订单 |
| 待核实 | 百度 OCR / 文档解析 | 报销资料、扫描件、表格、学习材料整理 | 付费识别 API | 云 API 能力；需核实个人开通、费用、认证格式及附件传递 |
| 4 | AntV 图表 | 报表、家庭预算、思维导图、行程展示 | 统计图表和路书生成 | 官方 npm MCP，无需凭据；已加入 Beta，默认远程出图 |
| 下一批 | 魔搭图像生成 | 工作配图、生活创作、计划展示 | 个人魔搭 Token + 用户专属托管连接 | 官方魔搭服务；先补托管导入与凭据 URL 处理 |
| 专项 | Gitee | 仓库资料、Issue/PR、研发工作规划 | 从读取仓库和 Issue 任务开始 | 官方 remote MCP + PAT；技术接入直接，面向研发用户 |
| 专项 | Apifox | API 文档检索、接口方案、测试用例分析 | 先采用现有项目文档 MCP；新版读写独立评估 | 官方 stdio 包可用；新版 remote 文档仍标为内测 |
| 可选 | Home Assistant | 家庭设备状态、场景控制、生活安排 | 访问用户已有 HA 实例及其暴露的设备 | 官方 remote MCP；可配置完整 URL + Token，受 HA 部署及设备接入前提限制 |
| 范围外 | 值得买「海纳」 | 预算选购、商品参数比较、优惠信息 | 消费数据 API | 需要申请 Key/审核及接口文档，不符合本轮条件 |
| 范围外 | 携程商旅 | 企业差旅查询 | 企业服务 | 需要申请，不是个人携程账号直接连接 |

## 2. 可快速接入的契约

### 滴答清单

官方帮助已明确国内地址 `https://mcp.dida365.com`，仅支持 Streamable HTTP。支持 OAuth 和 Bearer Token。网页版「设置 → 账户与安全 → API 口令」可创建 Token，第一版可直接沿用 `Authorization: Bearer {{secrets.token}}` 的模板和凭据存储。

官方列出任务、清单、习惯、专注记录和纪念日等工具，包括 `search_task`、`create_task`、`complete_task`、`list_habits`、`get_focuses_by_time`。xopc 已有任务能力，但这个 connector 的新增价值是让用户继续使用其原有滴答清单资料和多端习惯，而不是强制迁移。已加入 `dida365` 目录项及官方本地图标。

验收任务：「把这周会议行动项存入工作清单」「从过去一周任务及习惯记录生成复盘」。注意首次联调返回日期窗口限制、时区、重复任务和 Token 撤销状态。不能因官方支持 OAuth 就声称当前目录授权流程已实现 OAuth。

来源：[滴答清单官方 MCP 帮助](https://help.dida365.com/articles/7438132116019216384)。

### flomo

官方地址 `https://flomoapp.com/mcp`，Streamable HTTP，`Authorization: Bearer <个人 Token>`。用户在「设置 → MCP 连接 → 个人 Token」中创建，Token 仅显示一次，可单独注销。**需要 Max 会员**，不是面向开发者购买独立 API。

适合「找我过去关于这个决定的笔记」「把讨论结论保存为笔记」「整理复盘标签」。已加入 `flomo` 目录项、安全凭据引用、获取指引和官方本地图标。工具按真实连接返回结果发现，不硬编码官方主站和旧文档间变化的工具列表。

来源：[官方 MCP 总览](https://help.flomoapp.com/advance/mcp)、[官方 Token 配置](https://help.flomoapp.com/advance/mcp/connect-maxclaw.html)。

以下记录公共查询及个人可申请 API 的接入契约；需核实的服务尚未加入目录。

### 快递100

官方推荐 remote 地址 `https://api.kuaidi100.com/mcp/streamable?key=KEY`，也提供 Node 包 `@kuaidi100-mcp/kuaidi100-mcp-server`，凭据环境变量 `KUAIDI100_API_KEY`。

xopc 当前 `url` 必须是字符串；模板的凭据替换会生成 secret reference 对象，不能直接用于带 Key 的 URL。第一版优先使用固定 **1.0.4** 的 stdio 包，把凭据放入 env，无需为一个 connector 扩展 URL secret 功能。官方仓库 Python 示例支持从请求头读取 Key，但不能据此认定托管 endpoint 接受同一 header，应另行实测。

工具覆盖物流轨迹、寄件时效、在途时效和运费预估。用户需注册 API 开放平台并获取 Key；不是自动读取全部购物订单。部分物流轨迹需要手机号，套餐额度与实际查询权限以用户账号为准。

来源：[官方接入文档](https://api.kuaidi100.com/document/how-to-use-mcp-service/?from=bdaimcp)、[官方仓库](https://github.com/kuaidi100-api/kuaidi100-MCP)。

### 12306 查询

选候选项目 `Joooook/12306-mcp`，固定 npm **0.3.10**，stdio，不需要在模板中配置凭据。支持直达、筛选、经停和中转查询。

已加入 `railway-12306`，发布为 `experimental`，明确「社区查询工具，非铁路官方 MCP」。测试应包含预售期外、无票、跨日中转、多车站城市及真实查询失败。地图负责站点与目的地路线，12306 负责车次候选，计划写入文档或滴答清单。MCP 协议握手成功不能证明实时余票查询稳定。

来源：[维护者 README](https://github.com/Joooook/12306-mcp/blob/main/README.md)。

### 百度 OCR / 文档解析

官方提供 `https://aip.baidubce.com/mcp/ocr_general/sse` 和 `https://aip.baidubce.com/mcp/document/sse`。文档解析覆盖 PDF、图片、表格等格式。新版官方综合指南示例包含 header 认证，但不同章节混用 `Bearer%20` 与 `Bearer `；必须用真实 API Key 联调，核实实际接受的格式，不直接照抄编码混乱的示例。

应先验证模型能否把 xopc 附件交给工具：工具接受 URL、base64 或资源引用中的哪一种，本地文件如何传递；然后验收扫描件/表格输出。仅增加 catalog 卡片并不能保证附件业务可用。读取用户选定的样本，核实输出格式、付费额度和失败反馈。

来源：[官方能力列表](https://ai.baidu.com/ai-doc/OCR/Xmmk2iwdl)、[官方综合 MCP 指南](https://ai.baidu.com/ai-doc/REFERENCE/mm9tjwod0)、[OCR 接入指南](https://ai.baidu.com/ai-doc/OCR/mmmk8dayn)。

### AntV 图表

已加入 `antv-chart`，固定官方 npm `@antv/mcp-server-chart@0.9.10`，stdio，无需凭据。支持统计图表、思维导图和国内地图/路书，默认调用 `https://antv-studio.alipay.com/api/gpt-vis` 出图；已在目录描述中说明数据会发送到远程出图服务，不能描述为全部本地生成。官方 repo 支持 `VIS_REQUEST_SERVER` 自建出图服务，首版不要求个人用户自行部署。图标直接保存官方 repo 的 `icon.png` 原始字节。

来源：[AntV 官方项目](https://github.com/antvis/mcp-server-chart)、[国内魔搭服务页](https://modelscope.cn/mcp/servers/@antvis/mcp-server-chart)。

## 3. 研发与家庭专项

- **Gitee**：官方远程 `https://api.gitee.com/mcp`，PAT Bearer；本地包 `@gitee/mcp-gitee` 当前 1.0.0。可直接沿用远程模板，避免引入社区同名包。读写范围按实际 token、服务工具集和 xopc 现有政策验证。[官方说明](https://github.com/oschina/mcp-gitee/blob/master/README_CN.md)
- **Apifox**：现有项目文档 MCP 包 `apifox-mcp-server` 当前 0.0.17，env `APIFOX_ACCESS_TOKEN`，项目 ID 是配置输入。当前模板只支持完整 config 占位，不能直接拼 `--project={{config.projectId}}`；可检查包是否支持分离参数，或将完整参数作为配置。新版 remote 内测文档给 `https://api.apifox.com/mcp` 和 `X-Apifox-Api-Version: 2025-09-01`，支持更广的读写操作，需要资格/权限验证。[项目文档 MCP](https://docs.apifox.com/6327888m0)、[新版内测](https://docs.apifox.com/8395000m0)
- **Home Assistant**：官方 Streamable HTTP `/api/mcp` 或 `/api/mcp/assist`，Bearer 长效 Token；用户提供完整 endpoint 可沿用完整 config 占位。需先启用 HA 的 MCP Server 集成并暴露所需设备；不是直接登录米家账号。首版针对已有 HA 用户做状态查询和已暴露场景控制。[官方说明](https://www.home-assistant.io/integrations/mcp_server/)

## 4. 本轮排除的合作/平台能力

- **值得买「海纳」**：官方开放商品、价格、内容等消费数据，支持 API/MCP/A2A；当前首页说明申请审核后取得测试 Key 和接口文档。适合「预算 3000 元选手机，比较参数和好价」；查询来源、实付条件和跳转链接是验收重点。没有 Key 和契约之前不猜 endpoint、不标成已接通。[官方开放平台](https://ai.zhidemai.com/)
- **携程商旅**：2026-04-20 官方介绍对企业开放 MCP 基础信息、酒店/火车/机票推荐与核心查询。可申请体验，面向有企业差旅服务的用户。未取得 endpoint、企业授权及收费契约前不做通用模板。[官方介绍](https://ct.ctrip.com/thinktanks/235566117077549)
- **百度网盘**：官方仓库仍明确正式开放平台仅限企业开发者；个人提供限时体验且密钥会变化。远程 Token 放 URL、stdio 上传依赖 Python 源码部署。需正式开发者资格/用户 OAuth及凭据处理设计，不能作为普通个人账号稳定快接项。[官方接入与资格说明](https://github.com/baidu-netdisk/mcp/blob/main/README.md)
- **美团**：官方入口已展示个人开发者可实名开通 MCP/Skills，但本轮未取得完整可调用契约和工具目录。应继续进入官方 AI Hub 核实哪些是商家业务、哪些是消费者能力，不能沿用「没有 MCP」的旧判断，也不能承诺个人外卖账号下单。[官方平台](https://developer.meituan.com/)

## 5. 图标与产品入口

接入时延续第一批规则：官方产品图标保存到 `web/public/connector-icons/`，来源记录 `SOURCES.md`，目录 `branding.logoUrl` 使用本地资源；不让用户浏览目录时向供应商请求图片。

本轮滴答清单和 flomo 使用各自官网引用的 PNG 标识，AntV 使用官方 MCP 仓库图标，12306 社区工具使用官方 App Store 原始应用图标 并在名称中显示社区身份。来源已记录，避免暗示铁路官方 MCP。

任务示例建议与 connector 一起交付：

1. 工作：会议行动项 → 滴答清单任务 → 下周复盘。
2. 生活：flomo 个人笔记 → 生活复盘 → 滴答清单习惯记录。
3. 出行：用户提供行程 → 腾讯文档行程单 → 滴答清单出发准备事项；不声称个人订单已打通。
4. 规划：语雀 / flomo 资料 → 学习规划 → 滴答清单复习任务。

提醒的创建和执行是 xopc 自动化功能，需要独立绑定和验收；MCP 查询工具不等于已实现后台订阅提醒。

## 6. 本轮验证边界

Web 生产构建通过，四项新增图标均已复制到构建产物；官方 PNG 图标已目视核对，`git diff --check` 通过。

已核对官方帮助、官方仓库、npm 当前版本及凭据契约。目录/安装/凭据相关 46 项测试通过，根目录 TypeScript 检查通过。AntV 0.9.10 initialize/tools/list 返回 27 个工具，并使用两项非敏感示例数据成功调用条形图工具，取得远程图表 URL。使用假 Key 启动 `@kuaidi100-mcp/kuaidi100-mcp-server@1.0.4` 并执行 initialize/tools/list，成功返回 4 个工具；启动 `12306-mcp@0.3.10` 同样成功返回 8 个工具。未调用其业务 API。

本轮已加入滴答清单、flomo、AntV 图表的 Beta 模板，以及 12306 查询的 experimental 模板及图标；未配置用户账号、未申请商业接入、未做真实 Token/收费/附件业务测试。AntV 示例出图已完成，其余业务调用待验证。快递100/12306握手以及 AntV 工具发现仅证明协议配置，不代表实际业务验收。

进一步候选：Cubox 官方目前核实的是个人账号 CLI，需要单独适配，不能标为已核实官方 MCP；FlowUs 本轮仅核实 API 文档，未核实完整个人账号 MCP 契约，不列为即插即用；Get笔记当前维护者文档要求创建应用并提供 Key/Client ID，属于较高配置门槛，暂不列为快速接入项。[Cubox 官方 CLI](https://help.cubox.pro/ai/agents)、[FlowUs API](https://flowus.cn/developer-api/v2/zh/getting-started/overview)、[Get笔记项目配置](https://github.com/iswalle/getnote-mcp)


## 7. 国内魔搭广场的补充方向

采用国内入口 `https://www.modelscope.cn/mcp`，筛选个人能配置的服务，同时逐项记录维护者、Hosted/Local、账号要求和收费条件。Hosted 表示平台托管，不表示供应商官方、免凭据或拥有用户个人应用权限。本轮读取公开服务文档及官方 SDK；未登录魔搭账号、未部署用户服务。

| 场景 | 下一步候选 | 个人配置方式 | 判断 |
| --- | --- | --- | --- |
| 工作、规划 | AntV 图表 | 免凭据官方 stdio；也可由魔搭托管 | 本轮已加入；目录附国内魔搭链接 |
| 出行 | 12306 查询 | 免凭据社区 stdio | 本轮已加入；须显示社区身份与查询范围，不声称购票 |
| 工作、生活创作 | ModelScope Image Generation | 个人魔搭 API Token，在服务页配置后取得个人托管连接 | 下一批优先；只支持开启 API-Inference 的模型，额度以当前账号为准 |
| 工作调研 | ModelScope Hub MCP | 个人平台 Token、用户专属托管连接 | 模型/数据集/资源检索；偏技术用户，排在日常能力之后 |
| 工作调研 | 天眼查 tyc-mcp | 服务页要求天眼查 MCP API Key | Hosted 已有；个人购买资格、费用和查询权限未核实，不作为立即可用项 |
| 工作与内容 | MiniMax MCP | 自己的 MiniMax API Key、对应能力权限 | 官方服务方向，仍需核实本轮具体模型、套餐与工具契约 |
| 生活与内容 | 小红书社区 MCP | 登录个人账号，保存本地 Cookie、浏览器依赖 | 身份符合，但登录/发布维护成本较高；未核实稳定版本，不立即加入 |

图像生成来源：[魔搭官方服务页](https://modelscope.cn/mcp/servers/@modelscope/ModelScope-Image-Generation-MCP)、[官方使用介绍](https://modelscope.cn/learn/1438)、[个人访问令牌入口](https://www.modelscope.cn/my/myaccesstoken)。其他服务：[ModelScope Hub](https://modelscope.cn/mcp/servers/@modelscope/modelscope-mcp-server)、[天眼查](https://www.modelscope.cn/mcp/servers/TianYanCha/tyc-mcp)、[MiniMax](https://modelscope.cn/mcp/servers/@MiniMax-AI/MiniMax-MCP)、[小红书社区项目](https://www.modelscope.cn/mcp/servers/@XGenerationLab/xhs_mcp_server)。后一组仍是候选，不是已验证业务功能。

### 建议新增「魔搭个人托管服务导入」入口

魔搭官方 SDK 已提供三组独立能力：`list_mcp_servers` 查询广场、`list_operational_mcp_servers` 读取当前账号已启用的托管服务、`deploy_mcp_server` 创建账号自己的托管部署。正式开发使用官方公开 API 契约，避免依赖网页内部 `/v1/dolphin/mcpServers` 等接口。当前公开 HTTP 探测未取得成功返回，因此不能声称 OpenAPI 已联调通过。

首版建议用户保存个人魔搭 Token → 读取其已启用服务 → 展示服务、维护者、协议和有效期 → 用户勾选 → 作为独立 connector 导入。首版只读取现有部署；如增加托管创建，需按服务收集 `env_schema` 并说明供应商 Key 和平台 Token 是两类凭据。SDK 文档明确部署/删除要求 write 或更高 Token 权限，不能用读取账号服务的理由默认执行部署。

返回连接可能为 SSE 或 Streamable HTTP：SDK 中 `streamable_http` 必须映射为 xopc 的 `streamable-http`。官方 SDK 描述连接包含 `auth_required`、`expiration` 等部署信息；有效期可配置，不能把详情页的 24 小时默认显示当作所有服务的固定规则。

用户专属 URL 可能本身就授予访问能力。xopc 当前 URL schema 只接受字符串，秘密模板替换会生成 secret reference 对象；直接把专属 URL 放普通 config 会随 connector marker 一起持久化。实现托管导入前必须补 URL 的安全引用/解析及导出脱敏，并验证现有配置兼容性。目录应保存公开 service ID 与来源页，不能硬编码任何教程或账户的 UUID 连接。

验收：个人 Token 能列出自己的已启用服务；SSE/Streamable HTTP 均能初始化并发现工具；URL 和 Token 不出现在普通配置导出及日志中；过期连接提示重新获取；单项停用/卸载；服务名冲突；平台 Token 与供应商 Key 撤销后分别正确报错。图标从官方服务/产品资源保存本地并记录出处，无品牌的社区工具使用功能图标。

来源：[魔搭官方 MCP SDK](https://github.com/modelscope/modelscope/blob/master/modelscope/hub/mcp_api.py)、[魔搭客户端接入文档](https://modelscope.cn/docs/mcp/cherry-studio)。此入口为后续实施方案，本轮尚未实现账户同步。


## 8. 图标复核（2026-10-08）

12306 通用火车图标已替换为官方 App Store 原始应用图标；保留社区名称和 experimental 状态。全量本地图标已解码并做缩略图目视检查，国内品牌资源逐项比对官方源字节或 SVG 路径。另发现 Jira 错用了 Atlassian 公司标识、Gmail 使用旧版单色标识，均替换为官方当前产品图标。来源记录在 `web/public/connector-icons/SOURCES.md`。
