# Store Plugin 价值审查

日期：2026-10-18。范围：线上 Store 当前公开目录，不修改上下架、不发布新版本、不安装插件。

## 结论

用户对插件价值偏低的判断有明确事实支持：线上 84 个 Plugin 中，79 个（94.0%）没有增加执行工具或服务，只提供单个 950–1188 字节的 Skill，以及 README、manifest、图标。没有随包 reference、脚本、模板资产、数据源或业务校验程序。

这些内容有少量检查清单/写作结构价值，但不足以证明“用户应该专门安装一个插件”。建议从主 Plugin 市场移出，选择少量保留为任务模板或 Skill，其余归档。

其余四个远程 MCP 插件具备连接外部服务的价值，但业务指导也很薄；一个本地 MCP 数据工具有实际功能，但功能颗粒很小，更适合作为开发者样例或宿主的数据处理能力。

这不是模型效果 A/B 实验，不能量化安装前后的质量提升；判断基于实际包内容、工具能力、用户操作成本及与宿主基础能力的关系。没有执行真实外部账号业务。

## 证据与核查方法

1. 查询 `https://store.xopc.ai/api/v1/packages?type=plugin&pageSize=50&page=1` 和第二页，取得全部 84 个唯一条目；另查询 extension，共 20 个。
2. 读取全部 84 个 Plugin 详情。其最新版本均声明 source commit `eac65f6cae0ffd1a8ef5ba75544406383ab23d3b`、版本 `1.1.1`，指向 `xopcai/xopc-plugins`。
3. 从本地 `xopc-plugins` Git 对象中只读导出该 commit 的完整发布源码，统计全部包内容。
4. 实际下载 `weekly-report`、`notion-workspace`、`data-toolkit` 三个线上 ZIP；SHA-256 与详情完全一致，每个 ZIP 的全部文件内容也与上述 commit 完全一致。
5. 阅读代表性 Skill、MCP 实现和生成器，对照 xopc 当前插件、技能及 Connector 机制。

临时原始证据位于 `/tmp/xopc-store-plugin-audit`，包括线上两页目录、84 个详情、源码 inventory、三个 ZIP 和 Git 发布源码快照。未执行下载包中的代码。

所有条目的 API downloads 在本次查询时均为 0。这不足以证明从未使用：统计口径、重置、下载路径等均未验证，因此不作为淘汰理由。

## 一、79 个轻量内容插件：不值得占据独立 Plugin 入口

全部具有同样的四文件组成：

```text
README.md
plugin.json
assets/icon.svg
skills/<skill>/SKILL.md
```

Skill 内容通常是：Inputs、四条 Method、Deliverables、少量 Guardrails。没有增加账号连接、领域数据、自动执行、模板文件、例子、计算实现或验收机制。

重点不在“短”或“没有 MCP”，而在内容本身也缺乏通用模型难以自行补齐的知识和可复用资产。丰富且专业的纯知识 Skill 可以很有价值，本批内容尚未达到这个程度。

| 例子 | 包内实际增量 | 建议 |
| --- | --- | --- |
| weekly-report | 按成果分组、区分完成/进行/阻塞、量化影响、提出决策需求 | 周报任务模板；无需独立安装 |
| prd-writer | 区分问题与方案、定义范围和旅程、写可验证需求、列依赖风险 | 产品文档模板；补真实模板和样例后再评估 |
| meeting-actions / stakeholder-update / executive-brief | 常见信息整理结构 | 聊天任务入口或统一办公 Skill |
| sql-analyst | SQL 规划建议，不含数据库连接或执行器 | 更准确地作为 SQL 草拟模板；不宜暗示已具备数据分析执行能力 |
| forecasting-workbench | 四条预测方法提示，要求回测和区间；没有模型、回测代码或数据适配 | 暂停独立 Plugin 展示；补确定性分析流程 |
| financial-model-review | 追踪输入输出、检查单位、挑战假设、敏感性分析；无公式审计实现 | 专项检查清单；尚不构成财务模型审查工具 |
| ecommerce-listing | 功能转卖点、组织标题和描述、检查主张；无平台连接和发布 | 商品文案模板；不能与电商运营插件同级呈现 |
| support-ticket-triage | 分类、严重度、复现信息和回复草稿；无工单系统连接 | 模板；补拉取、分类回写与实际 policy 才有业务闭环 |
| travel-planner | 路线、预算、开放时间、备选安排建议；不提供专有数据源 | 普通任务模板 |
| research-literature-map | 筛选、提取、分组与研究空白建议；无文献检索/元数据/引文校验实现 | 方法清单；需真实检索和可验证交付才形成独立价值 |
| application-threat-model | 资产、边界、攻击目标和缓解方案提纲；无案例库/代码或架构解析 | 低成本方法提示，优先作为工程 Skill 内部章节 |

部分题目有使用频率和方法价值，例如 PRD、周报、复盘、需求评审、访谈整理。这说明应优化它们的产品归属，而不是认定这些任务本身没有价值。

不建议把 79 个逐项改名后继续作为 79 个安装项，也不建议简单把它们装进一个更大的“万能插件”。先判断真实用户任务，保留有复用价值的模板，交给宿主按需发现即可。

## 二、四个远程 MCP 插件：保留候选，改成可交付业务能力

| 插件 | 真实新增能力 | 当前不足 | 处理建议 |
| --- | --- | --- | --- |
| notion-workspace | 配置 `https://mcp.notion.com/mcp` 远程服务 | Skill 约 1 KB，只有搜索/预览修改等通用约定 | 保留集成候选；若只是连接入口则并入 Connector；补项目知识整理等具体流程 |
| linear-workspace | 配置 `https://mcp.linear.app/mcp` | 缺少有深度的规划、去重、依赖与状态变更流程 | 保留，围绕需求到 issue、项目周报等做端到端验证 |
| figma-workspace | 配置 `https://mcp.figma.com/mcp` | 没有真正的设计到代码实现协议和验收闭环 | 保留，补节点提取、组件映射、实现与截图验证 |
| cloudflare-workspace | 配置 `https://mcp.cloudflare.com/mcp` | 只有检查状态、最小范围、预览变更、验证回滚等通用步骤 | 明确服务可执行的动作范围，补至少一个具体运维场景后再主推 |

这里只确认其发布包声明了远程 MCP，不代表本次已验证上游当前在线、账号能授权、所有动作可调用或业务能完成。插件文本中把 endpoint 称为官方，也不自动证明功能覆盖完整。

同一业务同时存在 Connector 与 Plugin 时，应给用户统一入口。Connector 负责身份、连接和权限；Plugin 负责真正额外的业务方法、执行流程与交付。如果 Plugin 只有一份 endpoint 配置和通用提示，用户不应为它再理解一套重复的安装模型。

## 三、data-toolkit：有代码，但当前独立价值偏低

发布包包含本地 stdio MCP 和两项工具：

- `csv_summary`：对输入的 CSV 字符串计算表头、行数、缺失、数值范围/均值或字符串唯一值。
- `json_get`：对输入的 JSON 字符串按点路径取值。

实现不读取文件、不请求网络，也不接数据库。README 如实说明了这些边界。它确实增加了可重复计算能力，有一定技术价值。

但是以完整 Plugin 呈现，会引入安装、启用和 MCP 进程，而用户可做的事情很有限。允许现有命令/数据工具的 Agent 很容易完成相近处理；禁止这些能力的受限 Agent 可以受益，但需要明确目标用户和权限配置。

建议：保留为开发者参考，或把确定性数据处理沉淀为宿主工具；如果继续主推“数据工具箱”，应增加文件输入、较大数据处理、Schema/清洗、分析产物与验证，而不是继续增加宽泛名称。

## 四、20 个 Native Extension 混入产品目录的问题

当前 xopc 扩展市场会同时拉取 `type=plugin` 与 `type=extension`。线上 extension 中可见：

- `demo-provider`：mock streaming provider。
- `demo-skill-hub`：marketplace adapter 示例。
- `hello`：SDK iframe API 示例。
- `input-guard`、`context-injector`、`progress-tracker`：Hook/工具 API 示例。
- `custom-provider`：自定义模型注册演示。
- `echo`：消息回声行为。
- `weather-service`：通过 typed event bus 给其他扩展提供数据，主要体现开发集成接口，缺少直接用户任务描述。

这些适合作为开发者样例，默认展示给终端用户会显著降低市场质量感。建议移到开发者专区或隐藏，不因为它们是官方维护就当作推荐业务插件。

其他如图像供应商、语音、Telegram/Weixin、飞书工具和 Synapse，需要按运行能力、内置重复性和实际端到端使用分别审查；不能将它们与这些示例一并判为无价值。本次没有逐一下载和运行这 20 个 extension。

## 五、发现了“源码已清理，线上目录未同步”的事实

本地仓库：`/Users/micjoyce/develop/github/xopc-plugins`。

- 线上发布详情均指向 `eac65f6`。
- 本地 HEAD 为 `b3c210e`，提交标题 `feat: focus catalog on compound plugins`。
- 本地新目录已经删除 79 个内容插件，保留上述五个，并新增 `expo`、`supabase`、`zoom`，合计 8 个。
- 线上当前仍是 84 个旧包，三个新增包不在本次查询的 Plugin 目录中。

因此清理方向在源码中已经存在，线上用户还看不到结果。

当前 `scripts/publish-store.mjs` 只做：构建、筛选待发布项、比较版本/哈希、上传新版本、可选审批。它不对“线上存在但当前 catalog 已移除”的包执行下架/归档。

这意味着即便发布最新目录，旧包也不会因此消失。上线整理需要独立的目录核对与归档方案；只删 Git 目录不足以清理线上市场。

`expo/supabase/zoom` 的本地包有更多领域内容，分别有 13/2/27 个直接 Skill，以及大量 references，具有更好的候选基础，但不能只凭文件多就认定已可用。仍需核对 xopc 能识别哪些声明、哪些是其他宿主专属接口，并验证完整任务。

## 六、建议的处理顺序

1. 准备线上整理清单：79 个 Plugin 从主要发现入口移出；有用内容归任务模板或 Skill。优先归档/取消公开推荐，保留现有安装者需要的版本访问，避免直接删除历史产物。
2. 把 demo/sample Native Extension 从普通用户目录分离。
3. 四个远程服务插件各选一个目标任务，验证连接、读写行为、失败路径和最终产物。通过后再推荐。
4. `data-toolkit` 标为开发样例或补足真实数据工作流。
5. 检查本地三项新候选的宿主兼容与交付能力，再决定发布，避免以新文件规模替代质量验收。
6. Store 发布增加只读 catalog reconciliation 报告：新增、更新、线上遗留、拟归档。真正上下架由明确操作执行，不在普通 publish 中悄悄删除远端包。

本次只做审查，没有改线上发布状态、执行发布脚本或修改 `xopc-plugins` 内容。

## 七、后续准入应考察什么

核心问题：**用户安装它后，能稳定完成哪件之前做不好或做不到的事？**

可接受的增量至少应有一种：真实外部服务接入、专门执行工具、可靠领域知识、可复用素材/模板、可验证业务流程。纯知识包也可以合格，前提是知识本身确有深度和使用价值。

还需要：明确输入输出、一次代表性端到端验收、可理解的安装/授权步骤、失败与续办方式、权限边界，以及后续维护责任。

不采用“文件够多”“必须两个组件”“必须有 MCP”“发布者 verified”作为价值替代指标。当前 data-toolkit 已说明：有工具也未必值得独立安装；高质量纯知识包也可能比薄 MCP 包有价值。

## 附录：79 个建议降级或移出的内容插件

以下按发布源码名称列出，统一依据为：只有单个轻量 Skill，无独立执行/服务组件，也无成体系的参考资料与资产。并非宣称各任务没有业务需求。

- `accessibility-review` — 无障碍体验评审
- `analytics-tracking-plan` — 数据埋点方案
- `api-design-review` — API 设计评审
- `application-threat-model` — 应用威胁建模
- `architecture-decision-record` — 架构决策记录
- `board-meeting-pack` — 董事会会议材料
- `brand-voice-guide` — 品牌语调指南
- `budget-variance-analysis` — 预算差异分析
- `campaign-retrospective` — 营销活动复盘
- `cash-flow-forecast` — 现金流预测
- `compensation-benchmark-plan` — 薪酬对标方案
- `competitor-analysis` — 竞品分析
- `compliance-checklist` — 合规检查清单
- `content-calendar` — 内容日历
- `contract-review-brief` — 合同审查简报
- `crisis-communications` — 危机沟通方案
- `crm-pipeline-review` — CRM 销售管道评审
- `customer-feedback-insights` — 客户反馈洞察
- `customer-success-plan` — 客户成功计划
- `dashboard-narrative` — 数据看板解读
- `data-cleaning-plan` — 数据清洗方案
- `data-quality-audit` — 数据质量审计
- `decision-memo` — 决策备忘录
- `ecommerce-listing` — 电商商品文案
- `executive-brief` — 高管简报
- `experiment-analysis` — 实验分析
- `financial-model-review` — 财务模型评审
- `forecasting-workbench` — 预测分析工作台
- `go-to-market-plan` — 市场进入计划
- `hiring-scorecard` — 招聘评估表
- `incident-postmortem` — 故障复盘
- `interview-debrief` — 面试复盘
- `inventory-plan` — 库存规划
- `invoice-review` — 发票审查
- `job-description-writer` — 职位描述撰写
- `knowledge-base-writer` — 知识库撰写
- `localization-review` — 本地化评审
- `meeting-actions` — 会议行动项
- `metric-definition` — 指标定义
- `okr-review` — OKR 复盘
- `onboarding-plan` — 员工入职计划
- `organization-design` — 组织设计
- `performance-review` — 绩效评估
- `personal-learning-plan` — 个人学习计划
- `podcast-show-notes` — 播客节目笔记
- `policy-writer` — 制度文档撰写
- `prd-writer` — 产品需求文档
- `press-release` — 新闻稿撰写
- `privacy-impact-assessment` — 隐私影响评估
- `process-sop` — 流程标准作业程序
- `procurement-rfp` — 采购招标书
- `project-risk-review` — 项目风险评审
- `promotion-plan` — 商品促销方案
- `qualitative-coding` — 定性资料编码
- `release-plan` — 版本发布计划
- `requirements-review` — 需求评审
- `research-brief` — 研究简报
- `research-literature-map` — 研究文献图谱
- `review-insights` — 商品评价洞察
- `roadmap-prioritization` — 路线图优先级
- `sales-account-plan` — 销售客户计划
- `sales-call-coach` — 销售通话教练
- `seo-content-brief` — SEO 内容简报
- `service-blueprint` — 服务蓝图
- `social-media-plan` — 社交媒体计划
- `sql-analyst` — SQL 数据分析师
- `stakeholder-update` — 干系人进展同步
- `strategy-offsite` — 战略共创会
- `support-ticket-triage` — 客服工单分诊
- `survey-design` — 问卷设计
- `sustainability-report` — 可持续发展报告
- `test-plan` — 测试计划
- `training-course-outline` — 培训课程大纲
- `travel-planner` — 旅行规划助手
- `user-interview-synthesis` — 用户访谈洞察
- `ux-research-plan` — 用户体验研究计划
- `vendor-comparison` — 供应商对比
- `video-production-brief` — 视频制作简报
- `weekly-report` — 周报助手

## 代码与线上来源

- [线上 Plugin 目录，第 1 页](https://store.xopc.ai/api/v1/packages?type=plugin&pageSize=50&page=1)
- [线上 Plugin 目录，第 2 页](https://store.xopc.ai/api/v1/packages?type=plugin&pageSize=50&page=2)
- [周报插件发布详情](https://store.xopc.ai/api/v1/packages/weekly-report)
- [数据工具箱发布详情](https://store.xopc.ai/api/v1/packages/data-toolkit)
- [Notion 插件发布详情](https://store.xopc.ai/api/v1/packages/notion-workspace)
- 本地 xopc-plugins：`catalog.json`、`scripts/publish-store.mjs`、`scripts/generate.mjs`、`docs/roadmap.md`。
- xopc：`src/extensions/marketplace.ts`、`src/extensions/agent-plugins/validation.ts`、`src/agent/skills/format-skills-prompt.ts`。

## 线上清理执行记录

用户在审查后明确授权直接操作线上数据库删除无价值数据。以下清理于 **2026-10-18 23:20:56 +08:00** 完成；本文前面的 84/20 数字为清理前快照。

| 项目 | 删除数量 |
| --- | ---: |
| 轻量内容 Plugin | 79 |
| 演示 Native Extension | 9 |
| 历史版本 | 332 |
| 审核记录 | 332 |
| 包文件及无共享引用的图标文件 | 411 |

删除的演示扩展：`context-injector`、`custom-provider`、`demo-provider`、`demo-skill-hub`、`echo`、`hello`、`input-guard`、`progress-tracker`、`weather-service`。额外检查确认 weather-service 使用固定 mock 数据，是 typed event bus 的演示代码。

执行方式：先用 SQLite backup API 备份在线数据库，再归档并校验对应文件；使用精确包 ID 和类型白名单，在 `BEGIN IMMEDIATE` 事务中删除，并通过外键级联清除关联版本及审核记录；事务内验证所有保留包和版本记录不变。提交后按文件清单删除对应文件并移除空目录。

服务器备份目录（位于公开文件服务之外，目录权限 0700）：

`/var/backups/xopc-store/plugin-cleanup-20261018T232053+0800`

其中包括 `store-before.db`、`removed-files.tar.gz`、`plan.json`、`result.json`。数据库备份和文件归档均在删除前验证；文件归档逐项比对 SHA-256。

执行后验证：

- 88 个目标包在数据库中全部不存在，对应包目录全部不存在。
- SQLite `integrity_check` 为 `ok`，`foreign_key_check` 无异常。
- 其他数据库表的记录数及保留包、版本内容未被本次事务改变；825 个保留版本文件均存在。
- 公网 Plugin 列表为 **5**：Cloudflare、data-toolkit、Figma、Linear、Notion。
- 公网 Extension 列表为 **11**：dashscope、fal、feishu-tools、google、groq-stt、minimax、openai、synapse、telegram、tts-local-cli、weixin。
- 10 个 Connector 和 156 个 Skill 保留。
- 抽查被删除的 weekly-report、hello 详情及 weekly-report 下载地址均返回 404；保留的 Notion 包下载返回 200 且 SHA-256 不变。

本次实际删除了已审查的低价值和演示包，没有发布本地新增的 Expo/Supabase/Zoom，也没有改动服务部署代码。
