# 磁盘与目录布局

本文是 xopcbot **读写路径的简明对照表**。配置仍是唯一事实来源；具体解析见 `src/agent/agent-scope.ts`、`src/config/paths-state.ts`、`src/config/paths.ts` 及相关模块。

初始化步骤、模板说明与环境变量详见 [状态目录与工作空间布局](workspace.md)。

## 设计分工

| 区域 | 作用 |
|------|------|
| **状态目录** | 全局配置、凭据、日志、cron、全局 skills/extensions、托管工具链等。 |
| **Agent 主目录** `<stateDir>/agents/<agentId>/` | 按 Agent 隔离的运行时数据：会话 transcript、bootstrap 人格 Markdown、托管记忆、入站/TTS 落盘、会话级配置、ACP 索引等。 |
| **Agent 状态目录** `…/agents/<agentId>/agent/` | 进程状态：`agent.json`、每 Agent 凭据、IPC 收件箱、pid/socket、小型机器状态、扩展安装、出站崩溃恢复队列。 |
| **Markdown 工作空间** | 用户项目树：工具 **cwd**、每日 `memory/*.md`、`media/generated`、用户 `skills/`、任意用户文件。**不再**作为人格文件或内部状态的主存放位置。 |

下文默认状态根为 `~/.xopcbot/`；可用 `XOPCBOT_STATE_DIR`、`XOPCBOT_PROFILE`、`XOPCBOT_HOME` 覆盖（见 [workspace.md 环境变量](workspace.md#环境变量速查)）。

## 状态目录（全局）

默认：`~/.xopcbot/`

| 路径 | 用途 |
|------|------|
| `xopcbot.json` | 主配置（若未用 `XOPCBOT_CONFIG` / `XOPCBOT_CONFIG_PATH` 指向他处）。 |
| `credentials/` | 全局密钥：`auth-profiles.json`、`oauth/<provider>.json`。 |
| `extensions/` | 已安装扩展、`extensions-lock.json`。 |
| `skills/` | 全局托管技能包（`<id>/SKILL.md`）。 |
| `cron/` | `jobs.json`、`logs/`、`runs/`。 |
| `logs/` | 应用日志（可用 `XOPCBOT_LOG_DIR` 覆盖）。 |
| `bin/`、`tools/` | CLI 包装与工具运行时。 |
| `models.json` | 可选的自定义模型注册数据。 |

## Agent 主目录：`agents/<agentId>/`

由 `resolveAgentHomeDir(config, agentId)` 解析。常见结构：

| 路径 | 用途 |
|------|------|
| `bootstrap/` | 人格与引导 Markdown：`SOUL.md`、`IDENTITY.md`、`USER.md`、`TOOLS.md`、`AGENTS.md`、`HEARTBEAT.md`、`MEMORY.md`（系统提示用引导文件，与托管 `memories/` 不同）、`CONTEXT.md`、`SKILLS.md`、`BOOTSTRAP.md`。由 `loadBootstrapFiles`（`src/agent/context/workspace.ts`）加载。网关心跳文件通过 `resolveHeartbeatMdPath` 指向 `bootstrap/HEARTBEAT.md`。 |
| `sessions/` | 会话 transcript（分片、`index.json`、`archive/`）、`sessions/config/` 下按会话配置、`sessions/acp-sessions.json`（ACP 元数据索引）。 |
| `memories/` | 托管结构化存储（`MEMORY.md`、`USER.md`，条目以固定分隔符分段 — `BuiltinMemoryStore`）。 |
| `inbound/` | 入站附件（非图片二进制）落盘；transcript 中相对路径为相对 agent home 的 `inbound/...`。 |
| `tts/` | 按会话缓存的出站 TTS 音频。 |
| `agent/` | 见下节 **Agent 状态目录**。 |

种子目录：`xopcbot init` / `xopcbot agents add` 会创建 `bootstrap/` 与工作区骨架；模板位于 `src/agent/context/workspace-templates/`（参见 [工作区模板](/zh/reference/templates)）。

## Agent 状态目录：`agents/<agentId>/agent/`

由 `resolveAgentDir(config, agentId)` 解析。

| 路径 | 用途 |
|------|------|
| `agent.json` | Agent 元数据。 |
| `credentials/` | 每 Agent API 配置（如使用）。 |
| `inbox/pending/`、`inbox/processed/` | 基于文件的 IPC 收件箱。 |
| `pid`、`status.json`、`agent.sock` | 进程协调。 |
| `state/` | 机器状态（如 workspace 元数据、skills 扫描缓存）——**不是** Markdown 工作区下的 `.state/`。 |
| `extensions/` | 每 Agent 扩展安装根目录。 |
| `outbound-pending.json` | 出站消息崩溃恢复队列。 |

## Markdown 工作空间

由 `resolveAgentWorkspaceDir(config, agentId)` 解析：默认 Agent 常为 `<stateDir>/workspace`，其它 id 常为 `<stateDir>/workspace-<id>`，或由 `agents.defaults.workspace` / 列表项 `workspace` 指定。

**预期内容**（用户可见 / 工具面向）：

| 路径 | 用途 |
|------|------|
| `memory/` | 按日或主题笔记（`YYYY-MM-DD.md`）；`memory_search` 等与工具 cwd。 |
| `media/generated/` | 生图等输出。 |
| `skills/` | 用户自建技能。 |
| *任意文件* | `read` / `write` / `edit` 等工具操作对象。 |

新安装不会把内部状态写回 Markdown 工作区。本版本只支持文首表格中的 **单一目录树**：人设与机器状态均在 `agents/<id>/` 下，**不会**从「全部堆在 Markdown 工作区里」的旧布局自动迁移；bootstrap 请用 `xopcbot setup` / `xopcbot onboard`，其他数据需自行搬迁。

会话里引用的入站附件 / TTS 路径仅支持相对 `inbound/`、`tts/`（相对 agent home解析）。

## 运维辅助 API

- `listAgentWorkspaceDirs(config)` — 列出配置中所有 Agent 的 Markdown 根（`src/config/workspace-dirs.ts`）。
- `listAgentBootstrapDirs(config)` — 列出所有 `bootstrap/` 根，便于备份或外部编辑器挂载。

## 另见

- [状态目录与工作空间布局](workspace.md) — 初始化、环境变量、模板文件说明。
- [架构设计](architecture.md) — 各组件如何使用上述路径。
- [会话管理](session.md) — 会话存储布局。
