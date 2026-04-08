# 状态目录与工作空间布局

xopcbot 在单一 **状态目录**（“Agent OS” 根）下保存本机状态；其下有 **按 Agent 划分** 的目录树（会话、收件箱、运行时文件等）。**工作空间（workspace）** 是运行时用于引导 Markdown、工具侧数据、扩展安装以及入站附件落盘的目录。

路径解析见 `src/config/paths.ts`，目录骨架由 `xopcbot init` 创建（`src/cli/commands/init.ts`）。

## 状态目录根

默认：`~/.xopcbot`  
覆盖优先级（从高到低）：

| 方式 | 结果 |
|------|------|
| `XOPCBOT_STATE_DIR` | 显式指定状态根目录 |
| `XOPCBOT_PROFILE` | 当值存在且不为 `default` 时使用 `~/.xopcbot-<profile>` |
| `XOPCBOT_HOME` | 默认路径中的「家目录」基底（`$XOPCBOT_HOME/.xopcbot`） |

主配置文件为状态目录下的 `xopcbot.json`；若设置 `XOPCBOT_CONFIG` / `XOPCBOT_CONFIG_PATH` 则指向该文件。

## 全局目录（状态根下）

多 Agent 共享（除非另有说明）。

| 路径 | 作用 |
|------|------|
| `xopcbot.json` | 主配置（提供商、网关、通道、`agents.defaults` 等）。 |
| `credentials/` | 全局凭据；`auth-profiles.json`；OAuth 令牌 `oauth/<provider>.json`。 |
| `extensions/` | 已安装扩展与 `extensions-lock.json`。 |
| `skills/` | 技能包目录（每个技能为含 `SKILL.md` 的文件夹）。 |
| `cron/` | `jobs.json` 定时任务；`logs/` 按日 JSONL；`runs/` 按任务运行历史。 |
| `logs/` | 进程日志（`xopcbot-<date>.log`），可被 `XOPCBOT_LOG_DIR` 覆盖。 |
| `bin/` | 托管的 CLI 包装（如 `xopcbot`）。 |
| `tools/` | 内置工具运行时（例如 `tools/node/current/` 下的 Node/npm）。 |
| `models.json` | 模型注册表缓存。 |

## 按 Agent：`agents/<agentId>/`

`agentId` 默认为 `main`（`XOPCBOT_AGENT_ID`）。  
`XOPCBOT_AGENT_DIR` 可覆盖整个 `agents/<id>` 路径。

| 路径 | 作用 |
|------|------|
| `agent.json` | Agent 元数据（名称、模型提示、标签等）。 |
| `credentials/` | 该 Agent 专用凭据（`auth-profiles.json`）。 |
| `workspace/` | **工作空间目录** — 见下文。 |
| `sessions/` | 会话存储根：分片 transcript、`index.json`、`archive/` 归档目录。 |
| `inbox/` | 文件型收件箱：`pending/`、`processed/`（`<messageId>.json`）。 |
| `run/` | 易失运行时：`pid`、`status.json`、`agent.sock`（Unix 套接字）。 |

会话数据 **不在** Markdown 工作空间目录下，固定使用 `agents/<agentId>/sessions/`（若仍存在旧版 `<workspace>/.sessions`，可在新位置为空时做一次迁移）。

## 工作空间目录（`agents/<agentId>/workspace/`）

即 `resolveWorkspaceDir()` 的返回值；`xopcbot init` 会为指定 Agent 创建。

### 引导用 Markdown（人格与记忆索引）

这些文件会进入系统提示（加载顺序与长度限制见 `src/agent/context/workspace.ts`）。文件名常量见 `WORKSPACE_FILES`（`src/config/paths.ts`）。

| 文件 | 作用 |
|------|------|
| `SOUL.md` | 原则与「你是谁」。 |
| `IDENTITY.md` | 名称、语气、边界。 |
| `USER.md` | 关于人类用户的笔记。 |
| `TOOLS.md` | 环境相关的工具提示（主机、设备等）。 |
| `AGENTS.md` | 安全与协作规范。 |
| `HEARTBEAT.md` | 心跳 / 主动巡检配置（空或仅注释则跳过相关调用）。 |
| `MEMORY.md` | 长期记忆索引。 |
| `CONTEXT.md` | 当前焦点 / 在进行项目。 |
| `SKILLS.md` | 工作空间技能索引（可被自动维护）。 |
| `BOOTSTRAP.md` | 可选的上手说明；常由 `onboard` / 模板流程创建，`init` 不一定生成。 |

### 子目录与点目录

| 路径 | 作用 |
|------|------|
| `memory/` | 按日期或主题的片段（如 `YYYY-MM-DD.md`），配合 memory 类工具使用。 |
| `.state/` | 机器状态：`workspace.json`（引导种子信息）、`skills-cache.json` 等。 |
| `.extensions/` | 与工作空间绑定的扩展安装/缓存（扩展加载器使用）。 |
| `.sessions/config/` | Agent 服务写入的按会话配置（如模型覆盖），位于 **配置所指向** 的工作空间路径下。 |
| `.xopcbot/inbound/<session>/` | 入站附件（带二进制数据的非图片）落盘位置，便于 transcript 与 `read_file` 使用稳定路径。 |

## 运行时到底用哪个「工作空间」？

相关但不同来源的两套逻辑：

1. **配置项** `agents.defaults.workspace`（schema 默认 `~/.xopcbot/workspace`）— **网关** 等通过 `getWorkspacePath()`（`src/config/schema.ts`）使用。网关下扩展目录为 `<该路径>/.extensions`。

2. **CLI 默认上下文** — 若设置 `XOPCBOT_WORKSPACE` 则用之，否则 `resolveWorkspaceDir()` → `agents/<id>/workspace`（`src/cli/registry.ts`）。

因此执行 `xopcbot init` 后，引导文件在 `~/.xopcbot/agents/main/workspace/`，而新配置的 `agents.defaults.workspace` 仍可能是 `~/.xopcbot/workspace`。若希望网关与 CLI 共用同一套引导文件，请 **对齐二者**（改配置、或符号链接其一）。

## 环境变量速查

| 变量 | 作用 |
|------|------|
| `XOPCBOT_STATE_DIR` | 状态根目录 |
| `XOPCBOT_PROFILE` | 按 profile 的状态目录 |
| `XOPCBOT_HOME` | 默认状态路径中的家目录 |
| `XOPCBOT_CONFIG` / `XOPCBOT_CONFIG_PATH` | 配置文件路径 |
| `XOPCBOT_WORKSPACE` | CLI 使用的工作空间目录 |
| `XOPCBOT_AGENT_ID` | 当前 Agent id（如 `main`） |
| `XOPCBOT_AGENT_DIR` | 覆盖整个 `agents/<id>` 目录 |
| `XOPCBOT_CREDENTIALS_DIR` | 全局凭据目录 |
| `XOPCBOT_LOG_DIR` | 日志目录 |

## 另见

- [工作空间模板](reference/templates.md) — 各 Markdown 模板说明
- [会话管理](session.md) — 会话位于 `agents/<id>/sessions/`
- [架构设计](architecture.md) — 组件如何消费这些路径
