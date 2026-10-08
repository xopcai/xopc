# 中国用户 MCP Connector 场景与快速接入调研

调研日期：2026-10-08（Asia/Shanghai）。范围：当前 xopc 工作区源码、服务商官方文档、项目维护者仓库、npm 注册表。本文为选型和实施建议，未安装候选服务、未使用用户凭据、未完成带认证的端到端联调。

## 1. 建议先做什么

第一批建议新增 **腾讯文档、语雀、高德地图、Gitee、Apifox、百炼联网搜索**。前四项覆盖个人知识、办公产出、国内出行和研发协作；Apifox 补齐接口知识；百炼搜索补齐中文信息获取。高德先走官方 stdio 包，其他远程服务优先使用 Streamable HTTP。

第二批考虑 **云效、智谱搜索/网页读取、AntV 图表、百度网盘、钉钉 AI 表格**。其中云效可以很快实现技术连接，但需要限定工具集；智谱 Coding Plan 服务受套餐约束；网盘涉及授权续期和上传方式；钉钉表格需要取得具体实例地址。

**12306 和小红书可以成为有辨识度的实验功能，但不宜作为首批稳定内置能力。** 企业查询、金融数据、支付、购物下单应按特定客户或商户需求推进，不能因为 MCP 市场存在卡片就认定能向所有个人用户开放。

这不是用户需求统计结论。优先级根据现有产品定位、场景完整性、官方接入路径、用户配置门槛和工程工作量判断；后续应通过安装转化、首次成功任务及复用情况验证。

## 2. 仓库现状：已有能力与实际缺口

中国连接器目录位于 [china-catalog.ts](../../../src/connectors/china-catalog.ts)，目前有五项：

| 连接器 | 当前实现 | 当前目录声明的能力 | 本次建议 |
| --- | --- | --- | --- |
| 飞书办公 | CLI，lark 1.0.96 | 搜索/读取文档、日历、联系人、创建日程 | 补场景与权限，不再新增一个默认飞书 MCP 卡片 |
| 企业微信 | CLI，wecom 1.3.0 | 文档、联系人、待办及创建待办 | 明确是企业账号的办公资源，不能宣传为个人微信聊天读取 |
| 钉钉办公 | MCP，dingtalk-mcp 1.1.21 | 通讯录、日历、待办、机器人/工作通知 | 保留；单独调研 AI 表格，不假设已包含 |
| WPS 365 | CLI，0.3.6 | 企业云文档、日历、邮件，只读 | 不能把 WPS 365 企业权限等同于所有个人金山文档权限 |
| 腾讯会议 | 远程 MCP，Beta | 个人会议查询、创建、管理 | 先复核当前官方接入契约，再扩展纪要任务 |

以上是源码定义，不能推断当前用户已安装或已授权。

可复用基础：

- [types.ts](../../../src/connectors/types.ts)：连接器定义、密钥表单、配置表单、服务模板、展示状态。
- [materialize.ts](../../../src/connectors/materialize.ts)：将目录模板转成 MCP 服务配置，密钥使用引用，支持 Header 中拼接 `Bearer `。
- [runtime-adapter-registry.ts](../../../src/connectors/runtime-adapter-registry.ts)：安装/卸载 MCP，保存凭据与安装时定义快照。
- [mcp-transport-config.ts](../../../src/agent/mcp/mcp-transport-config.ts)：stdio、SSE、Streamable HTTP。
- [health.ts](../../../src/connectors/health.ts)：连接和能力发现诊断。成功列出工具不等于有权读取具体文档或执行业务操作。
- [schema.ts](../../../src/config/schema.ts)：支持 HTTP MCP OAuth，但配置限制其用于 Streamable HTTP；不能与静态 Authorization Header 混用。

三个会影响“快速接入”的真实约束：

1. **URL 密钥引用尚未打通。** `url` 必须为字符串；Header/env 支持 `xopcSecretRef`。高德 `?key=`、网盘 `?access_token=` 不能直接照搬为嵌入式密钥模板，否则 schema 校验会失败。高德可以先用官方包的 env；网盘需要补 URL 引用或受控代理。
2. **配置值只支持完整占位符。** `{{config.projectId}}` 能解析，`--project-id={{config.projectId}}` 不会拼接。Apifox 应验证拆分参数 `--project-id`, `{{config.projectId}}` 是否有效；不行则扩展模板解析或安装时组装。不要把表单值塞进 shell 命令字符串。
3. **MCP 多账号不是完整的业务账号体验。** 内置 MCP 通常使用固定 serverId；安装同服务新凭据会替换配置。需要多项目/多账号时必须先设计实例 ID、凭据归属和任务绑定，不能复用 Composio 的界面后直接声称已经支持。

知识图谱工具在本次会话中未暴露，因此源码发现使用文件搜索回退。仓库原有未提交代码修改未变动。

## 3. 从用户任务出发的场景地图

| 用户与任务 | 可串成的流程 | 连接器组合 | 价值与边界 |
| --- | --- | --- | --- |
| 办公：把聊天中的结论变成可分享成果 | 查已有文档 → 整理 → 创建周报/方案 → 返回文档链接 | 腾讯文档、语雀；已有飞书/WPS | 从回答变成实际交付物；不同文档类型需要不同操作契约 |
| 项目管理：销售线索、客户跟进、团队任务 | 查表结构 → 筛选记录 → 汇总 → 更新指定记录 | 钉钉 AI 表格、飞书多维表格 | 必须先核实已有飞书 CLI 覆盖；表格字段与记录 ID 不能靠猜 |
| 国内差旅：会议、火车、最后一公里 | 查会议 → 查车次 → 规划车站到客户的路线 → 输出行程 | 已有腾讯会议 + 高德 + 12306 实验项 | 查询、规划可落地；余票不是保证，未提供购票闭环 |
| 个人知识：查找自己的方法论、沉淀研究 | 搜索知识库 → 读取正文 → 形成有来源的结论 → 创建新文档 | 语雀、腾讯文档、百度网盘 | 网盘文件管理不自动等于全文搜索/OCR/RAG |
| 中文研究：行业、产品、公开资讯 | 搜索 → 阅读来源 → 交叉核实 → 输出调研文档 | 百炼搜索、智谱搜索/网页读取、腾讯文档 | 保留 URL、发布时间和抓取时间；搜索结果不能替代原文证据 |
| 研发：根据团队 API 和 Issue 实施需求 | 读 API 文档 → 查 Issue/代码 → 形成方案 → 创建 PR | Apifox + Gitee；第二批云效 | 是互补组合：Apifox 提供接口知识，Gitee 提供代码协作 |
| 运维：解释线上异常 | 查告警 → 查日志 → 关联部署 → 提交排查结果 | 阿里云可观测性/云效；腾讯云相关 MCP | 先面向已有云账号的技术用户，按资源/地域限定 |
| 内容运营：选题与素材调研 | 搜索笔记 → 归纳话题 → 准备内容 → 用户确认发布 | 小红书实验项、中文搜索 | 浏览器登录与站点变化增加维护成本，不承诺后台长时间稳定运行 |
| 文书：票据、扫描件和资料处理 | 识别图片 → 提取字段 → 写入表格或形成报告 | 百度 OCR + 腾讯文档/表格 | 要验证附件上传链路、图片大小、字段质量和计费 |
| 商户：订单查询和客服处理 | 查交易状态 → 回答客服 → 经确认执行退款 | 支付宝 MCP | 商户订单能力；不是读取个人支付宝全部消费记录 |
| 企业研究/金融分析 | 查企业或行情 → 保留数据日期与来源 → 生成摘要 | 天眼查/企查查、Wind/iFinD 等待核实项 | 授权、商业许可、收费与数据时效是主要阻力，暂不列为快接承诺 |

推荐先形成三个演示闭环：**中文调研 → 腾讯文档**、**知识检索 → 语雀文档**、**Apifox API + Gitee Issue → 研发方案**。它们比仅展示连接器数量更能说明产品价值。

## 4. 第一批候选：可快速实现，但仍需真实账号验收

| 候选 | 来源/协议/认证 | 可交付的首版 | 接入阻力 | 建议 |
| --- | --- | --- | --- | --- |
| 腾讯文档 | 腾讯文档团队公布的远程服务；URL + Authorization Token | 文件搜索、正文读取、创建智能文档/表格 | 会员权限、动态工具变化、写权限 | P0，先读和创建，后支持修改已有文档 |
| 语雀 | 官方 `yuque/yuque-mcp-server`；stdio + API Token | 搜索知识库、读文档、创建/更新文档 | 用户取得 API Token 的资格；团队空间 host | P0，适合个人知识和团队文档 |
| 高德 | 官方远程 HTTP/stdio；地图 API Key | POI、天气、交通路径、差旅行程 | 远程 URL 含 Key；本地包依赖下载；API 配额 | P0，先用 stdio，后统一 URL 密钥能力 |
| Gitee | 开源中国官方远程 MCP；个人访问令牌 | 仓库/文件/Issue/PR 查询；用户开启后写入 | PAT scope、工具集裁剪、企业版差异 | P0，优先远程，不必要求 Go 环境 |
| Apifox | 官方 npm MCP；stdio + Token + projectId | 接口/模型文档上下文，支持研发方案与代码生成 | 参数模板、项目缓存刷新、多项目 | P0，首版一项目；不是通用 API 测试执行器 |
| 百炼 WebSearch | 阿里云官方托管 HTTP；通用 DashScope Key | 中文联网研究与来源链接 | 需要在 MCP 广场开通；额度；不能复用套餐 Key 的假设 | P0 搜索候选；与现有 web_search 做明确路由 |

### 4.1 腾讯文档

服务地址：`https://docs.qq.com/openapi/mcp`。个人 Token 取得入口：`https://docs.qq.com/open/auth/mcp.html`。官方团队示例把 Token 原值放到 `Authorization`，没有展示 `Bearer ` 前缀，不能套用统一前缀。文档列出搜索、内容读取、创建和表格更新等工具，并列出 VIP 权限不足错误；哪些功能需要会员应在联调中形成矩阵。[腾讯文档团队接入说明](https://developer.cloud.tencent.com/mcp/server/11803)

建议表单只要求 Token，提供获取入口；首版任务是“读取链接”和“创建报告并返回链接”。修改旧文档要增加目标定位和变更预览。授权页本次抓取超时，未核实 Token 有效期。

### 4.2 语雀

通用启动方式为 `npx -y yuque-mcp`，凭据 env 为 `YUQUE_TOKEN`，空间/私有部署使用 `YUQUE_HOST`。维护者提供搜索、知识库和文档读写工具。[官方仓库](https://github.com/yuque/yuque-mcp-server)

建议按“个人知识库”和“团队空间”给两个引导例子，默认限制写能力，先读后写。API Token 可获得性和账号权益需真实验证，不承诺所有免费账号可用。与 WPS/飞书的差异在于独立知识库检索及 Markdown 沉淀。

### 4.3 高德地图

官方远程地址：`https://mcp.amap.com/mcp?key=KEY`。官方本地包：`@amap/amap-maps-mcp-server`，env：`AMAP_MAPS_API_KEY`。[快速接入文档](https://developer.amap.com/api/mcp-server/gettingstarted)

首版选择 stdio 避免 URL 引用改造；远程服务作为后续首选方向。展示位置、预计时长、交通方式及查询时间，不把路线结果包装为打车/订票已完成。地理能力也可帮助销售客户拜访和本地生活，不局限于旅游。

### 4.4 Gitee

官方远程地址：`https://api.gitee.com/mcp`，Header 为 `Authorization: Bearer TOKEN`。本地替代包 `@gitee/mcp-gitee` 会下载平台二进制，所以优先远程。服务支持 Header 工具过滤，例如 `X-MCP-Enabled-Tools`。[官方说明](https://gitee.com/oschina/mcp-gitee/blob/master/README_CN.md?skip_mobile=true)

建议提供代码/Issue/PR 只读集合，单独开放评论或 PR 创建；PAT 的第三方权限与 xopc 执行权限分开解释。不要将 Gitee 公有服务端点直接套用到任意私有企业实例。

### 4.5 Apifox

官方示例使用 `apifox-mcp-server`、`--project-id=<ID>` 和 `APIFOX_ACCESS_TOKEN`。它将项目 API 文档缓存到本地，变更后需要刷新，也支持 OpenAPI 文件和私有服务地址。[官方仓库](https://github.com/apifox/apifox-mcp-server)

建议定位为“API 文档”，首版只支持一个项目，验证缓存刷新、Token 权限和返回大小。多项目应作为多个稳定实例实现。官方项目不能与社区同名包或不同参数契约混用；上线前核对包 provenance。

### 4.6 百炼联网搜索

官方示例直接使用 `https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp` 和 `Authorization: Bearer DASHSCOPE_API_KEY`；需开通对应 MCP 服务，文档说明部分服务存在月度额度，用尽会停止。[外部调用文档](https://docs.agent.bailian.aliyun.com/zh/mcp/external-invocation)

建议先独立 MCP 进行场景评测，再决定是否桥接统一 `web_search`。当前 [search/registry.ts](../../../src/agent/tools/search/registry.ts) 的本地服务商包括 Brave、Tavily、Bing、SearXNG 和 XOPC Cloud，中国 fallback 是 Bing HTML；本次未检查 Cloud 后端，不声称 Cloud 没有中文搜索。添加连接器本身不会改变已有搜索工具的行为。

## 5. 第二批与垂直候选

| 候选 | 已核实接入事实 | 主要用途 | 为什么放第二批/垂直场景 |
| --- | --- | --- | --- |
| 云效 | 官方 HTTP `https://openapi-rdc.aliyuncs.com/ai/mcp`；Bearer PAT，区域版独立域名；可按工具集过滤 | 项目、代码、流水线协作 | 技术接入快，但部署/代码修改需要细化权限；面向已使用云效的团队。[官方说明](https://github.com/aliyun/alibabacloud-devops-mcp-server/blob/master/README.md) |
| 智谱联网搜索 | HTTP `https://open.bigmodel.cn/api/mcp/web_search_prime/mcp`；Bearer Coding Plan Key | 中文搜索、实时信息 | 有套餐门槛，团队套餐 Key 不与其他平台 Key 通用；不承诺普通模型 Key 可直接用。[官方文档](https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server) |
| 博查搜索 | 官方 Python/uv 本地项目；`BOCHA_API_KEY`；网页/AI 搜索 | 中文研究的供应商替代 | 官方当前示例需要源码目录，初次安装不如 HTTP/npx 模板简单；可评估 API 原生适配，不能把社区 npm 包当官方包。[官方仓库](https://github.com/BochaAI/bocha-search-mcp) |
| 百度 AI 搜索 | 官方提供 MCP 接入说明和搜索能力 | 中文资讯/百科/资料 | 已取得的文档示例含旧 HTTP/SSE URL，应从控制台核实当前 HTTPS/HTTP 接入再固化模板。[官方说明](https://ai.baidu.com/ai-doc/AppBuilder/wm88pf14e) |
| 百度地图 | 官方 npm/stdio + AK，也提供远程接入 | 高德的地图替代，交通/地理查询 | 与高德场景重叠，先做好一个供应商再增加选择。[官方仓库](https://github.com/baidu-maps/mcp) |
| AntV 图表 | `@antv/mcp-server-chart`；stdio；默认访问远程渲染服务，支持自定义 `VIS_REQUEST_SERVER` | 从表格/研究结果产生图表 | 零 Key 的启动体验好；需要图片输出/保存链路；不是完全离线渲染。[官方仓库](https://github.com/antvis/mcp-server-chart) |
| 百度网盘 | 官方 SSE URL 含 access_token；本地 Python 方案支持上传，SSE 不含上传 | 个人云盘文件整理 | URL 凭据、OAuth 续期和本地文件上传链路都需补齐；文件搜索不等于文件全文理解。[官方仓库](https://github.com/baidu-netdisk/mcp) |
| 钉钉 AI 表格 | 作者仓库自述官方维护，指向钉钉 MCP 市场获取用户服务 URL；提供 Base/字段/记录操作示例 | 轻 CRM、项目数据、任务表 | 尚未取得可固化的 endpoint/auth/有效期契约，不直接沿用现有办公 MCP 凭据。[项目说明](https://github.com/aliramw/dingtalk-ai-table/blob/main/GETTING_STARTED.md) |
| 百度 OCR | 官方 AI 开放能力文档提供 API Key MCP 接入 | 发票/票据/扫描件结构化 | 按具体服务核实 endpoint、收费和工具；附件 URL/上传与字段质量是额外工作。[官方文档](https://ai.baidu.com/ai-doc/OCR/mmmk8dayn) |
| 阿里云 OpenAPI | 官方托管 SSE/HTTP、OAuth；控制台选择具体 MCP 服务，也有凭据代理 | 资源查询、审计、权限诊断 | `https://api.aliyun.com/mcp` 是控制台访问入口，不能误当所有用户共用的业务 MCP endpoint；需要实例配置和权限范围。[官方说明](https://github.com/aliyun/alibabacloud-api-mcp-server) |
| 阿里云可观测性 | 官方当前项目已改写为 Go，提供平台二进制；SLS/CMS 数据 | 日志和监控诊断 | 需要二进制安装/升级、RAM 权限和资源配置，不应照抄旧 Python 版本模板。[官方说明](https://github.com/aliyun/alibabacloud-observability-mcp-server/blob/master/README.md) |
| 支付宝 | 官方包 `@alipay/mcp-server-alipay`，npm README 描述交易相关工具 | 商户交易创建、查询、退款 | 商户/应用凭据和交易契约；适合行业连接器，不适合个人账单入口。发布前核对专项许可证。[官方 npm 包](https://www.npmjs.com/package/@alipay/mcp-server-alipay?activeTab=readme) |

腾讯云 MCP 广场有云存储、日志和云开发等候选，适合继续从官方产品仓库逐项核实；广场本身是发现入口，不是统一服务地址。[腾讯云 MCP 广场](https://developer.cloud.tencent.com/mcp?channel=ugc)

## 6. 实验项与尚未核实项

### 6.1 12306：技术上容易，业务可靠性需要观察

社区 `Joooook/12306-mcp` 提供 `npx -y 12306-mcp`，可查车次、过滤、过站和中转，没有要求 MCP 用户配置 Key；它不是铁路官方 MCP。[维护者仓库](https://github.com/Joooook/12306-mcp)

建议命名“火车票查询（实验）”，只承诺查询，显示时间和结果来源；验收车站/城市区分、跨日、中转和空结果。不要把查询失败等同于无票，不加入自动抢票、支付或全天高频轮询的首版范围。

### 6.2 小红书：场景强，运行维护不轻

社区 `xpzouying/xiaohongshu-mcp` 支持登录、搜索、详情和内容发布，依赖浏览器和登录状态，支持 Docker/二进制等部署方式。[维护者仓库](https://github.com/xpzouying/xiaohongshu-mcp)

建议作为用户自部署的实验连接器；先读和选题分析，发布单独开启。需要解决浏览器生命周期、登录恢复、Cookie 隔离、本地图片路径和多账号问题。它与现有 HTTP Token 型连接器的交付成本不在同一量级；热度不构成稳定性证明。

### 6.3 暂不进入快速接入承诺

天眼查/企查查、Wind/同花顺 iFinD、淘宝/京东/美团下单、个人微信/QQ 历史聊天、夸克/阿里网盘完整读写、知网/中文论文全文库：本次没有取得足够的一手资料同时证明通用第三方 MCP 接入、可获得认证、当前端点、完整业务权限和商业使用条件。

这不代表没有服务。需要进一步取得产品官方接入文档或合作支持，避免把市场镜像、演示、自建爬虫和正式开放能力混为一谈。国内邮箱也值得做，但应先比较 IMAP/SMTP 原生实现与 MCP 的实际收益。

支付宝 Alipay+ 官方 MCP 是蚂蚁国际支付接口，面向不同商户场景，不能作为国内个人支付宝连接器替代。[官方仓库](https://github.com/alipay/global-alipayplus-mcp)

## 7. 维护、版本与许可证核实

以下为本次直接读取 npm 注册表得到的 latest 元数据，**不等于在 xopc 上已验证可运行**。上线要固定经过验证的版本，不能自动使用 `@latest`。

| npm 包 | latest | 发布日期 | 注册表许可证 | 判断 |
| --- | --- | --- | --- | --- |
| `yuque-mcp` | 1.0.0 | 2026-05-27 | MIT | 存在正式发布与官方仓库关联 |
| `apifox-mcp-server` | 0.0.17 | 2025-12-26 | ISC | 存在可安装版本；注册表未给 repository，需要核对发布产物来源 |
| `@antv/mcp-server-chart` | 0.9.10 | 2026-02-25 | MIT | 存在正式发布与官方仓库关联 |
| `@amap/amap-maps-mcp-server` | 0.0.8 | 2025-04-25 | ISC | 本地包发布较早；文档还提供更新方向的远程路径 |
| `@gitee/mcp-gitee` | 1.0.0 | 2026-04-23 | MIT | 存在发布；本地启动还涉及平台二进制下载 |
| `12306-mcp` | 0.3.10 | 2026-07-30 | MIT | 存在较近期发布，但社区项目可靠性仍需观察 |
| `dingtalk-mcp` | 1.1.21 | 2026-01-20 | MIT | 与当前 xopc 固定版本一致 |
| `@alipay/mcp-server-alipay` | 2.0.0 | 2026-01-12 | 指向专项许可 | 不能默认按 MIT 处理 |

数据来源分别为 `https://registry.npmjs.org/<package>`，包页面可从 [npm](https://www.npmjs.com/) 查看。仓库 README 与 npm 已发布版本可能不同，工具清单必须以固定版本运行结果为准。

GitHub 未认证 API 本次统一返回 403 rate limit exceeded，因此没有可靠取得最近 commit 日期；没有用搜索引擎抓取时间冒充维护时间。远程闭源服务以当前官方说明和真实联调判断，不用 npm 发布日期推断服务停更。

## 8. 比加目录更重要的共性改造

### 8.1 为 MCP 补明确的权限与动作契约

当前 [mcp-provider.ts](../../../src/agent/external-tools/mcp-provider.ts) 检查工具 deny，并支持 before-tool hook，但 `execute` 的 approvalId 参数没有被消费，也没有自动调用 [policy.ts](../../../src/connectors/policy.ts) 的 read/write/admin 分级评估。CLI/Composio 是另一条执行路径。现有 hook 可以另行限制工具，不能据此宣称 MCP 已有一致的写操作确认。

建议为推荐连接器提供 xopc 维护的动作清单：读取、创建、更新、删除分别标注，按具体 toolRef 控制，未知新工具默认不进入已审核集合。对 `execute_api` 这类通用工具，权限必须根据目标操作判断，不能仅按工具名分类。远程 `readOnlyHint` 只作参考，不替代本地契约。

首批腾讯文档/语雀可以先只放出读能力，创建文档在权限契约接通后启用。Gitee、云效的删除/部署不随一般写权限自动放开。

### 8.2 区分已安装、认证成功、业务可用

健康检查增加一个最小只读业务 probe：语雀读取当前用户，Gitee 读取身份/允许仓库，Apifox 读取指定项目，腾讯文档读取允许范围。返回失败应区分未授权、会员不足、没开通服务、额度用尽、资源权限不足。工具可列出但资源访问失败应呈现为部分可用。

### 8.3 国内体验应减少环境配置

优先 HTTP + Header，其次固定版本 npm stdio，最后 Python/Go/Docker。不要让普通用户填 MCP JSON；展示“连接语雀”“获取 Token”等产品步骤。进阶配置才展示传输、工具白名单、实例域名和超时。

提供准确的凭据取得入口，并将“个人 Token”“团队 Token”“企业应用 Client ID/Secret”“套餐 Key”明确区分。已有模型 Key 只能在用户选择复用且服务商文档证明通用时复用，不能自动推断权益。

### 8.4 把能力串成任务，但不自动采集数据

目录附带中文任务示例；工具层配套分页、类型识别、来源链接、目标定位和结果检查。连接成功不自动开启知识扫描或定时任务；延续仓库现有连接器体验设计。

研究/写文档可用 MCP 快速接入；高频中文搜索随后评估是否纳入统一搜索服务商，降低工具选择歧义。工具目录采取按任务发现和裁剪，避免办公/云服务成百上千接口进入上下文。

## 9. 建议实施顺序与工作量

工作量是工程估计，假设有测试账号、当前基础设施可复用、没有跨团队外部审批；不是承诺工期。真实授权、会员/企业管理员流程另计。

| 阶段 | 工作 | 估计 |
| --- | --- | --- |
| A | 腾讯文档、语雀、高德、Gitee 四个目录模板、图标、文案、固定版本、安装/健康检查测试 | 每项约 0.5–1.5 人日 |
| A 配套 | MCP 动作契约与写操作权限；最小业务 probe；确认结果回传 | 约 3–5 人日，需按现有执行链路细化 |
| B | Apifox 参数兼容与单项目、百炼搜索、云效裁剪 | 每项约 1–2 人日；多项目另计 |
| C | URL 密钥引用、实例化凭据归属、多账号/多项目与授权更新 | 单独做技术设计，不纳入“目录快接”预算 |
| 实验 | 12306 固定包、查询验证、失败提示 | 约 1–2 人日，不含持续上游维护 |
| 实验 | 小红书用户自部署的接入指导 | 约 1–2 人日；若管理浏览器/登录/多账号，预计至少数个额外人日 |

落点：`src/connectors/china-catalog.ts`、`web/public/connector-icons/`、连接器 i18n/说明、`src/connectors/__tests__/china-catalog.test.ts`。复用现有通用 API 时通常无需新增路由；若新增认证/业务 probe API，须同步 lazy-bundles 映射并经过运行中的已认证 Gateway 验收。

六项首批候选均先标 Beta；达到真实环境验收后再调整 verificationLevel。对官方服务也应明确会员、套餐、项目和资源访问范围。

## 10. 上线验收与评测

每个候选至少验证：安装 → 认证 → tools/list → 一次真实读取 → 权限不足 → 凭据更新 → Gateway 重启后恢复。支持写入的还应在测试空间验证一次可回读的创建/修改，并验证用户拒绝后没有外部写入。Token 不放进聊天和日志。

首批示例任务：

- 腾讯文档：读取一份指定文档，生成报告到测试空间，回读正文并核对链接。
- 语雀：搜到目标知识库文档，验证分页/正文，再创建一个测试文档。
- 高德：查询国内车站/客户地址，比较公共交通和驾车路线，验证同名地名处理。
- Gitee：限定测试仓库读取 Issue 和代码，再经权限流程创建一个可检查的评论或 PR。
- Apifox：读取一个项目的接口字段，更新原项目文档后验证 MCP 缓存刷新。
- 百炼搜索：中文实体/资讯/技术文档问题，检查结果来源、空结果与额度耗尽反馈。

搜索供应商用同一批约 30–50 个中文问题比较：资料覆盖、有效原文链接、时效信息、失败率、耗时和任务总成本。不要只用服务商营销示例判定质量；本次未进行这样的效果评测。

产品指标：首次连接成功率、首次业务读取成功率、首次成果创建成功率、七日复用、授权失败原因、任务是否依赖人工补操作。它们用于决定是否将第二批候选提到默认推荐位置。

## 11. 需要更新的已有连接器说明

飞书官方 MCP 仍存在，文档支持 App ID/Secret 与用户 OAuth；但目录已经优先 CLI，首要动作应是核实 CLI 对目标场景的覆盖，不创建重复默认入口。[飞书官方 MCP](https://github.com/larksuite/lark-openapi-mcp)

腾讯会议当前官方帮助说明将接入描述为 Skill 封装和 Python 代理，注入 Token 及版本信息；明确个人账号体验，并包含录制与纪要工具。仓库直接 HTTP 模板应复核当前版本/header 契约，目录“企业账号需申请灰度”也需重新核实。未联调前不能因 URL 存在就认为所有这些工具在现有模板下可用。[腾讯会议当前官方说明](https://meeting.tencent.com/support/topic/2233/index.html)

钉钉现有 `dingtalk-mcp` 与官方仓库及 npm 版本对应；默认工具集应继续按场景限制。[钉钉官方项目](https://github.com/open-dingtalk/dingtalk-mcp)

## 12. 证据边界

已经完成：现有源码与接入约束检查；上述候选一手文档核对；八个 npm 包版本、日期和许可证元数据核对；场景、优先级与工程路径评估。

尚未完成：国内网络实测、用户授权与真实业务调用、供应商效果对比、具体会员/配额价格、灰度资格、Token 续期、所有固定版本的完整工具契约、商业合作授权。调研中打不开或只有二手材料的候选均未作为“可立即上线”结论。
