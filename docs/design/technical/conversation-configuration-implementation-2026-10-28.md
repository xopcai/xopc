# 对话配置分阶段实施与验收记录

日期：2026-10-28。对应[产品方案](../conversation-first-configuration-product-plan-2026-10-28.md)。

按用户要求，顺序为 **Skill → MCP → 自动化**。每阶段先完成实现与自动 E2E，再进入下一阶段。真实模型通过实际 Web Chat 接收自然语言；验收只观察产品状态和真实结果，不替 Agent 发管理请求，不因失败修改评分门槛。

## 阶段进度

验收结论限定于下表和证据列出的核心范围，不等于产品方案第 6 节的全部发布用例均已覆盖。远端账号身份、原生渠道和跨领域通用密钥适配仍是独立待办，详见文末。

| 阶段 | 实现 | 验收 | 下一步 |
| --- | --- | --- | --- |
| Skill | 已完成本阶段：status／enable／disable、删除锁记录清理、安装持久意图回执、按需 manual 和用户文档 | 33 个真实模型 Web 场景 + 3 个公共市场安装／卸载与桌面布局场景通过；共享回归 51 文件 431 项通过 | 后续阶段保留回归 |
| MCP | 已完成本阶段：持久目标、安全输入页、pi OAuth、原会话自动续跑、执行前校验和直接配置入口 | 40 项完整 Web 矩阵通过，含 20 条负例、管理页刷新、桌面布局与完整秘密扫描 | 已验证成果用法引导、管理链接实际打开与刷新，保留回归 |
| 自动化 | 已完成本阶段核心：真实终态等待、稳定回执、相对一次性日程、通知、MCP 来源与参数约束、连续会话运行隔离 | 46 项真实模型 Web 场景通过，含 20 条负例、真实收件箱和两次重启后的真实定时执行 | 保留回归；账号身份 adapter 与其他范围见后续缺口 |

## 可复跑入口

```bash
XOPC_CONFIGURATION_E2E_LIVE=1 pnpm exec tsx scripts/verify-conversation-configuration-e2e.mts
```

需要现有 XOPC Cloud 登录，用真实 GPT-5.6 Sol 推理；不打印凭据。测试 Gateway、数据库、工作区与安装目录均隔离，不修改日常配置。浏览器使用 production Web 静态资源，Gateway 使用本次源代码。

默认证据在 `.xopc-evals/conversation-configuration/skills/`，每个用例保存检查结果和浏览器截图，失败不会记成通过。`XOPC_CONFIGURATION_E2E_OUT` 可指定独立运行目录。服务日志仅保存在私有文件中。

Skill 安装测试使用本地真实归档，内容是销售周报流程；模型响应不 mock。它能验证安装、刷新、使用、停启、卸载的产品链路，不能冒充公共市场或第三方 OAuth 验收。脚本支持 `skills`、`mcp`、`automations` 三阶段；诊断用 smoke 明确标注为局部验证，不能替代完整阶段验收。

已覆盖公共市场发现、实际公共包安装／卸载、受限来源拒绝、错误来源恢复、跨进程恢复、管理链接和 20 条中英文无写入负例。核心证据见[结构化报告](evidence/conversation-configuration-skills-2026-10-28.json)，原始截图与逐步结果在 `.xopc-evals/conversation-configuration/skills-final/` 和 `skills-public-final/`。

公共市场安装单独复跑：`XOPC_CONFIGURATION_E2E_LIVE=1 XOPC_CONFIGURATION_E2E_PUBLIC_INSTALL=1 pnpm run test:configuration:e2e`。根项目类型检查、E2E 脚本类型检查、受影响源码 ESLint 和 diff 检查通过。脚本不在根 ESLint 匹配范围内，使用独立 TypeScript 配置检查。

实测曾发现明确安装请求被重复索要确认，导致模型只给业务结果、未安装。已修复常驻工具摘要与引导，并用原始需求复测。验收脚本修复过响应嵌套、系统任务基线、页面恢复后发送就绪和 Markdown 可见文字匹配；这些脚本问题与产品缺陷分别记录，不将失败轮次计为通过。

本阶段覆盖本地 owner Web；未声明原生移动端或其他渠道通过。MCP 的测试服务按用户 2026-10-28 补充要求自行在本地构建，不再要求第三方测试账号；这不代表第三方服务兼容性验收。

## MCP 当前实现与复跑

```bash
XOPC_CONFIGURATION_E2E_LIVE=1 XOPC_CONFIGURATION_E2E_STAGE=mcp pnpm run test:configuration:e2e
pnpm run test:configuration:check
```

`scripts/conversation-configuration-test-server.mts` 启动独立的 HTTP MCP 和 OAuth 服务，校验 Token、动态客户端注册、PKCE、授权码一次性使用与 refresh token。浏览器点选真实授权页；测试不直接写管理 API，也不替模型执行工具。每个服务生成独立资料标记码，以服务端实际调用记录和聊天结果判定是否读取成功。

密钥只通过 `/mcp-setup/:setupId` 安全页提交；持久配置使用 CredentialResolver 引用，OAuth 由 pi 管理。目标绑定会话、transcript、Agent 与版本，取消／reset／配置改变后执行前再次校验；过期目标不续跑。局部保存但运行时 reload 失败时报告待重启，不宣称已可用。移除自定义服务不表示撤销远端授权或卸载软件包。

完整通过证据在 `.xopc-evals/conversation-configuration/mcp-final/`，可提交的脱敏结果见 [MCP 结构化报告](evidence/conversation-configuration-mcp-2026-10-28.json)。包含不提供技术 ID 的普通请求、只连接不读取、错误 Token 重输、取消、拒绝 OAuth、重启续跑、停启移除、服务不可用和 20 条负例。模型请求、全部聊天、配置和诊断日志均完成测试秘密扫描。

失败轮次保留：曾发现模型未经探测误报工具／回环服务不可用，以及明确移除请求仍被重复确认。已增加小型直接配置入口、Gateway 执行位置说明、明确授权语义，并对无实际工具调用的错误能力声明做一次有界事实纠正；真实权限拒绝不会因此被重试绕过。补充了实际 Agent runner 的有界纠正测试。测试运行器另修复初始化编辑器重建与可选引导的竞争，不将这些脚本问题当作产品通过。

运行器使用现有真实 Cloud 登录并安全刷新；MCP 测试凭据只保存在隔离目录。诊断请求仅写入被忽略的私有证据文件，不提交聊天或完整请求内容。

## 自动化实现与验收

```bash
XOPC_CONFIGURATION_E2E_LIVE=1 XOPC_CONFIGURATION_E2E_STAGE=automations pnpm run test:configuration:e2e
```

复用原有 AutomationService、capability dispatcher、调度器和投递 outbox。新增内容：

- `automation` 与 `xopc_use` 的默认重试键沿用工具调用 ID，显式意图键仍可跨工具重试；不以随机新键重复创建任务。
- `get_run {runId,waitMs}` 最多等待 30 秒，返回真实终态或仍在运行的事实。试跑成功后才启用同一个任务，不把 simulate／入队回执当成果。
- 一次性请求支持 `trigger.schedule:{kind:"once",afterMs:90000}`。在稳定回执的原子执行内换算并保存绝对 `at`；重试不延后时间，也不生成每年重复的 cron。
- 需要成功通知的提醒／报告使用 `notificationPolicy:all`；`attention` 只报告需要处理的情况，不能冒充成功提醒。真实通知与执行结果分别验收。
- 自定义 HTTP MCP 的只读自动化先生成 `mcpSourceId`，固定服务／凭据引用、工具契约及参数哈希。每次运行先复核来源和 schema，运行时只连接该服务，并由原生 pi 的调用守卫拦截其他工具或变化的参数。每轮必须有成功的选定工具调用，模型回答或历史结果不能代替它。
- 启用需要同一对象、同一 action 的成功试跑。替换 Agent action 时保留原来源绑定；更改内容／来源／执行助手后需要暂停并重新试跑。来源停用或改变时失败，不选其他服务；任务即使来源失效也能暂停／删除。

自动化核心矩阵已在 `automations-run3/` 通过 44 个场景，含两次真实时钟触发：普通一次性提醒，以及 MCP 来源任务在重启后的后续运行。服务每次读取都生成新标记码，以独立调用记录、当前 run 的时间窗口、运行 transcript 和结果共同核对，不能用旧结果通过。最终扩展矩阵在 `automations-final3/` 完整通过 46 项，另验证真实界面通知、连续会话的每轮新读取和桌面布局。连续会话恢复连接时暴露了旧 MCP 守卫被复用的产品缺陷；已将运行身份加入 runner 指纹，新增回归断言并完成重跑。脱敏结果见[自动化结构化报告](evidence/conversation-configuration-automations-2026-10-28.json)。

实测发现过“一次性提醒被保存成年重复 cron，回复却称一次性”的产品错误，已增加相对一次性输入并复测。后续轮次还发现明确删除请求被重复索要确认；已将现有授权规则前置到常驻工具摘要和 automation 描述，避免仅依赖早先加载的手册。管理链接实际打开当前聊天内的编辑对话框；运行器原先误等页面跳转，现按真实产品行为验收。通知验证后也通过真实关闭动作退出通知面板和导航抽屉，不把遮挡后的发送失败算作产品通过。测试还修正了服务显示名不等于内部 ID 的错误假设；时间修改的保留断言只允许原 instruction 内同一句“上午九点”同步改为“上午十点半”，其余 action 仍要求精确保留。

## 范围与后续缺口

本次是本地 owner Web 的配置闭环，移动宽度与桌面布局分别验证。原生移动端、Weixin／Telegram 的安全回流仍需独立实现和验收。

MCP 授权验收使用用户明确要求的本地真实协议服务器，不代表任意第三方 OAuth 的兼容性。自动化来源固定服务、工具与参数，**不独立验证远端账号身份**；明确指定账号的流程仍需身份 adapter，未验证时保持草稿，不能宣称账号验收通过。动态查询参数也需要专用范围 adapter，不能自动放宽固定参数约束。

已有未绑定来源的通用 Agent 自动化沿用原有行为；新增强约束作用于带 `mcpSourceId` 的流程，不声称已给所有历史任务补上来源约束。Skill 缺少依赖或密钥时会准确报告阻塞；本次没有自动安装任意依赖或覆盖全部 Skill 的密钥配置。跨领域通用 secret adapter、来源详情展示和账号校验、原生渠道、周期能力巡检、生成业务 Skill 与双 Panel 保持后续任务，不因本次测试创建日常巡检任务。

性能先记录真实运行基线，不宣称秒级 SLA。推理代理的 `elapsedMs` 仅到上游响应头，不是完整任务耗时；配置流程与人工授权等待必须分开衡量。

## 已记录的响应基线

从最终运行的隔离 SQLite 只读提取 `session_inputs`，以 Gateway 接受输入至该输入轮次完成计时。Skill 31 个用户输入：p50 4.03 秒、p95 16.17 秒；MCP 34 个用户输入：p50 4.92 秒、p95 15.16 秒。包含只读负例；不是完整安装／授权流程耗时，不包含浏览器渲染、人工授权和另行入队的恢复输入，不据此承诺端到端 SLA。原始统计定义与样本数保存在对应脱敏证据。

自动化最终轮次有 41 个用户输入，p50 7.82 秒、p95 22.49 秒；同样不等于整个流程耗时。两次用户创建的一次性日程实际启动延迟均为 6 毫秒，执行分别约 4.66 秒、6.97 秒。这是本机隔离环境的一轮观测，不是调度 SLA。

共享回归 51 文件、431 项通过；末次修复后，来源／runner 9 项、capabilities／runner 29 项和 prompt 95 项定向回归通过（与共享套件存在重叠，不累加宣称覆盖数）。根项目及 Electron 类型检查、E2E 脚本类型检查、受影响源码 lint、production Web build 和 diff 检查通过。包契约文件不在根 ESLint 匹配范围，已由类型检查覆盖。

## 实际操作视频

录制了约 3 分钟连续实操，另导出 90 秒的 2 倍速版本，均无配音。内容依次为 Skill 安装／使用／停启、HTTP MCP 安全 Token 输入与原会话续跑、自动化草稿／真实试跑／一次性调度／通知。使用真实模型和 production Web，服务与数据隔离；这是代表性演示，不替代完整验收矩阵。

视频位于本地 `.xopc-evals/conversation-configuration/video-demo-final/`：`conversation-configuration-demo.mp4`、`conversation-configuration-demo-2x.mp4`，旁有章节、校验值和导出恢复说明 `video-manifest.json`。已检查安全输入掩码和最终通知画面。录制模式在登录后才开始，不录入 Gateway 登录凭据。

```bash
XOPC_CONFIGURATION_E2E_LIVE=1 XOPC_CONFIGURATION_E2E_STAGE=automations \
XOPC_CONFIGURATION_E2E_RECORD_DEMO=1 \
XOPC_CONFIGURATION_E2E_OUT=.xopc-evals/conversation-configuration/video-demo \
pnpm run test:configuration:e2e
```

该模式生成 WebM，可用 FFmpeg 导出 MP4；`setpts=PTS/2` 可生成明确标注的 2 倍速副本。录制导出曾遇到提前关闭 browser 的问题；完整 WebM 已恢复并验证可播放，脚本现先关闭 recording context 再保存视频，导出 API 检查和脚本类型检查通过。

## 微信接续实现

后续微信安全输入、OAuth Gateway 回流、原私聊自动续跑和提醒投递的实现、独立证据与手机自测清单，见[微信对话配置记录](weixin-conversation-configuration-2026-10-28.md)。本页原有三个阶段的历史验收数不与后续微信套件累加，也不代表微信官方客户端已通过。
