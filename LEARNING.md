# xopc 递进式学习路径

> 目标：从"能跑起来"到"能改代码、能讲清楚架构"，按阶段递进。
> 每个阶段都有三样东西：**要读的文件**（真实路径）、**动手任务**、**验收标准**。
> 完成一个阶段、通过验收后再进入下一个。预计总时长 3–4 周（每天 1–2 小时）。

**通用方法**（每个阶段结束时做三件事）：
1. **画图**：把读到的结构画成架构图/时序图（纸笔或 draw.io 均可）。
2. **复述**：用 Feynman 法把本阶段内容讲给"完全不懂的人"听，讲不通的地方就是没懂的地方。
3. **留痕**：把笔记存到 `docs/notes/`（自建目录）或自己的笔记系统，方便回看。

---

## 阶段 0：环境与全景（约 1 天）

**目标**：把项目跑起来，建立全局地图。

**读**：
- `README.md` + `README.zh-CN.md` —— 产品定位（"Turn goals into loops"，四层架构）
- `docs/architecture.md` —— 系统架构 + 三条主数据流 + 存储模型
- `docs/concepts/loops.md` —— 连续工作模型（理解产品为什么这么设计）
- `AGENTS.md` —— 开发指南：模块地图、代码风格、日志规范
- `package.json` 的 `scripts` —— 这是项目的"操作面板"

**动手**：
- `pnpm run dev -- --help` 看命令列表
- `pnpm run dev -- agent -m "你好"`（需先配置模型 API key；config 见 `.env.local.example` / `docs/getting-started.md`）
- `pnpm run dev -- gateway` 启动网关，浏览器打开本地端口看控制台

**验收**：能说出四层架构各是什么；能在 `src/` 下指出至少 5 个核心目录及各自职责；知道 `dev`、`build`、`test`、`typecheck` 四个脚本干什么。

---

## 阶段 1：CLI 与配置（1–2 天）

**目标**：理解进程如何启动、配置系统如何工作。

**读**（按顺序）：
- `src/cli/bin.ts` —— 进程入口，注意它为什么"保持依赖最小化"
- `src/cli/index.ts` —— commander 组装、默认命令、长驻命令
- `src/cli/registry.ts` + `src/cli/command-loaders.ts` —— 命令如何自注册、懒加载
- `src/cli/commands/` 里挑 2 个简单命令通读（如 `version`、`doctor`）
- `src/config/` —— schema（zod）、loader、paths（配置文件在哪、怎么解析）

**动手**：
- 在 `src/cli/commands/` 下照葫芦画瓢**新增一个 `hello` 命令**（输出一行字），注册并运行它
- 改 `.env.local` 里一个配置项，观察对 `xopc doctor` 输出的影响

**验收**：能解释 `bin.ts → index.ts → registry → 具体命令` 的加载链；能说清 `LONG_RUNNING_COMMANDS` 是干什么的；你的 `hello` 命令能正常运行。

---

## 阶段 2：网关层（2–3 天）

**目标**：理解 HTTP + SSE 服务如何组成，gateway 如何成为"组合根"。

**读**（按顺序）：
- `src/gateway/server.ts`（约 200 行）—— Hono 服务器骨架，先读这个
- `src/gateway/hono/app.ts` + `src/gateway/hono/middleware/` —— 中间件（auth、log-context、rate-limit、CORS）
- `src/gateway/hono/routes/status.ts`、`sessions.ts`、`you.ts` —— 挑 2–3 个路由看 REST 风格
- `src/gateway/hono/routes/agent-stream.ts` + `src/gateway/hono/sse.ts` —— SSE 长连接
- `src/gateway/service.ts`（1868 行）—— **重点**：先读前 200 行看服务清单与依赖注入，再读 start/stop 生命周期，最后对照 `docs/architecture.md` 的架构图

**动手**：
- `pnpm run dev -- gateway` 启动后，`curl localhost:端口/api/status` 看返回
- 用 curl 发一条 SSE 请求（`curl -N`），观察事件流
- 给某个路由**加一个只读端点**（如 `GET /api/ping`），测试它

**验收**：能默写 gateway 组合了哪些服务（MessageBus、ChannelManager、AgentService、SessionStore、tasks、automations…）；能画出 SSE 与 REST 的分工；能说清 `service.ts` 与 `server.ts` 的边界。

---

## 阶段 3：智能体运行时（3–4 天，核心中的核心）

**目标**：理解一次"回合"（turn）从输入到输出的完整路径。

**读**（按顺序）：
- `src/agent/service.ts`（1104 行）—— 先读结构，认识 AgentManager / ModelManager / TurnDispatcher / AgentOrchestrator / OutboundCoordinator
- `src/agent/orchestration/agent-orchestrator.ts`（300 行）—— 回合执行主循环
- `src/agent/orchestration/agent-event-handler.ts` + `loop-guard.ts` + `llm-turn-retry.ts` —— 事件、防失控、重试
- `src/agent/inbound/` —— 输入如何进入 agent
- 工具系统：`src/agent/tools/factory.ts`、`src/agent/tools/exec-command.ts`、`read.ts`、`apply-patch.ts`、`web.ts`（理解"工具"是什么、怎么被调用）
- `src/agent/mcp/` —— 出站 MCP 工具（工具从哪来）

**动手**：
- 配好模型后跑 `pnpm run dev -- agent -m "…"`，开 `--verbose` 观察日志里的 `llm_request` / 工具调用
- **给 agent 新增一个最小自定义工具**（如返回当前时间的 `time` 工具），在对话中让它调用
- 看 `src/agent/__tests__/` 下测试怎么写的，为你的新工具补一个测试并跑通

**验收**：能画出"输入 → TurnDispatcher → Orchestrator → 模型 → 工具调用 → 输出/持久化"的时序图；能解释 loop-guard、compaction（会话压缩）为什么存在；你的工具 + 测试能通过。

---

## 阶段 4：状态与存储（2–3 天）

**目标**：理解 SQLite 持久化模型与迁移机制。

**读**：
- `src/storage/sqlite/schema.sql` + `schema.ts` —— 全库表结构（这是"事实来源"）
- `src/storage/sqlite/connection.ts` + `transaction.ts` + `paths.ts`
- `src/storage/sqlite/session-repository.ts` + `transcript-repository.ts` + `notes-repository.ts` —— 挑 2–3 个仓库类看 CRUD 模式
- `src/storage/sqlite/migrations/` —— 迁移如何演进 schema
- `src/session/store.ts`（1114 行）—— 会话层如何包在 repository 之上

**动手**：
- 启动 gateway 后 `sqlite3 ~/.xopc/xopc.db ".tables"` 和 `.schema` 看真实库
- 给某个 repository 写一个 vitest 测试（参考 `src/storage/sqlite/__tests__/`）
- 手动发起一次聊天，观察 `session.transcript` 表新增的行

**验收**：能说出至少 10 张核心表各自干什么；能解释 `session.input-state` 快照的用途；能说清迁移怎么跑、为什么不能乱改历史迁移。

---

## 阶段 5：渠道与扩展（2–3 天）

**目标**：理解多渠道接入与扩展运行时，以及 MCP 双向桥。

**读**：
- `src/channels/manager.ts`（292 行）+ `pipeline.ts` + `plugin-types.ts` —— 渠道抽象
- `src/channels/plugins/bundled.ts` —— 内置渠道如何注册
- `extensions/telegram/` —— 挑一个真实渠道插件通读（入站接收 → 归一化 → 出站发送）
- `src/extensions/` —— 扩展运行时（manifest、激活、SDK）
- `src/mcp/`（入站 MCP serve）+ `src/agent/mcp/`（出站工具）对照看

**动手**：
- 写一个**最小 ChannelPlugin**（如 log 插件：收到消息就打印），注册进 `bundled.ts` 并跑通
- 用 `xopc mcp serve` 起一个 MCP 服务，用 MCP 客户端连上看工具列表

**验收**：能画出"平台事件 → 渠道插件 → MessageBus 入站 → AgentService → 出站 → 渠道发送"的完整链路；能解释 inbound/outbound 分离与重启重放机制。

---

## 阶段 6：持久工作模型（3–4 天）

**目标**：理解 tasks / workflows / automations / projects / 记忆系统如何组成"循环"。

**读**：
- `src/tasks/` —— 任务聚合与执行协调（单工作状态机）
- `src/workflows/` —— 可观察工作流
- `src/automations/` —— 调度/事件触发
- `src/projects/` + `src/goals/`（如有）—— 项目与目标
- `src/agent/memory/` + `src/knowledge/` + `docs/user-understanding.md` —— 记忆与用户理解系统
- `src/work-discovery/` —— 系统如何主动发现工作
- `docs/concepts/system-prompt.md`

**动手**：
- 用 CLI/Web 建一个 project + goal，创建一条 task，手动触发一次 automation（参考 `docs/projects-tasks-notes.md`、`docs/automations.md`）
- 用 `xopc_use` 工具对象（本地有 `xopc_use` 工具）实际操作一次 project/task，读它的实现 `src/agent/tools/xopc-use-tool.ts`

**验收**：能解释"目标 → 任务 → 工作流/自动化 → 执行 → 复盘 → 下一动作"的闭环；能说清 task 与 workflow/automation 的关系（task 拥有工作状态，后两者是执行能力）；能说出记忆系统"摄入 → 治理合成 → 去重 → 上下文规划"的流程。

---

## 阶段 7：Web 控制台（2–3 天）

**目标**：理解 React 前端如何与 gateway 双向通信。

**读**：
- `web/src/main.tsx` + `app.tsx` —— 入口与路由
- `web/src/lib/` —— API client、SSE 订阅封装
- `web/src/stores/` + `web/src/providers/` —— 状态管理
- 挑一个 feature 读通：`web/src/features/sessions/` 或 `work-discovery/` 或 `connectors/`
- `web/src/i18n/` —— 双语（en/zh）文案结构

**动手**：
- `pnpm dev:web` 跑起前端，连本地 gateway，完成一次真实聊天
- 在某个 feature 页面加一个展示元素，跑通 lint + build

**验收**：能画出"页面 → REST 调用 → SSE 事件流 → 状态更新 → UI 刷新"的闭环；能说出前端与 gateway 的通信协议（接口 + 事件类型）。

---

## 阶段 8：贯通与贡献（持续进行）

**目标**：端到端贯通，开始真正改代码。

**任务**：
1. **端到端复述**：选一条真实链路（如"Telegram 收到消息 → agent 回合 → 回复 → 落库"），在代码里找到每一环的入口文件，画出完整调用链。
2. **读决策记录**：`docs/adr/` 是架构决策记录——理解"为什么这么设计"比"怎么设计"更高一层。
3. **跑通质量关卡**：`pnpm typecheck`、`pnpm test`、`pnpm run build`、`pnpm lint`——能修好其中任何报错就是进步。
4. **真实案例学习**：当前工作区有一批未提交改动（connectors / user-context / work-discovery，跨 `src/connectors`、`src/user-context`、`src/storage/sqlite/*repository`、`web/src/features/*`），是一份"后端 + 存储 + 前端"全栈真实案例，用 `git diff` 逐文件读。
5. **动手贡献**：从自己发现的 bug / 体验问题入手，走"改 → 测试 → typecheck → build"闭环；参考 `CONTRIBUTING.md`。

**验收**：能不带笔记讲 30 分钟 xopc 架构；能独立完成一个小功能/修复并跑通全部质量关卡。

---

## 学习节奏建议

| 阶段 | 内容 | 预计 |
|---|---|---|
| 0 | 环境与全景 | 1 天 |
| 1 | CLI 与配置 | 1–2 天 |
| 2 | 网关层 | 2–3 天 |
| 3 | 智能体运行时 | 3–4 天 |
| 4 | 状态与存储 | 2–3 天 |
| 5 | 渠道与扩展 | 2–3 天 |
| 6 | 持久工作模型 | 3–4 天 |
| 7 | Web 控制台 | 2–3 天 |
| 8 | 贯通与贡献 | 持续 |

- 阶段 0–2 是"地基"，建议完整走完再深入。
- 阶段 3 是核心，值得放慢；阶段 4–6 可并行交叉。
- 每阶段验收不通过就回头重读，别硬往下走。
