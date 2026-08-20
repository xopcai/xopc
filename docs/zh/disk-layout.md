# 磁盘与目录布局

本文列出 xopc 在磁盘上的主要读写位置。实际路径以 **配置文件**（默认 `~/.xopc/xopc.json`）及环境变量（如 `XOPC_CONFIG`、`XOPC_WORKSPACE`）为准。

初始化步骤、模板说明与环境变量详见 [状态目录与工作空间布局](workspace.md)。

## 设计分工

| 区域 | 作用 |
|------|------|
| **状态目录** | 全局配置、凭据、日志、全局 skills/extensions、托管工具链等。 |
| **智能体主目录** `<stateDir>/agents/<agentId>/` | 按 `agentId` 隔离的运行时数据：**`profile/`** 下的 profile Markdown（`SOUL.md` 等）、入站/TTS 落盘。会话 transcript 存储在 **`xopc.db`**，而非 `sessions/`。 |
| **智能体状态目录** `…/agents/<agentId>/agent/` | 进程状态：`agent.json`、各智能体凭据、IPC 收件箱、pid/socket、小型机器状态、扩展安装、出站崩溃恢复队列。 |
| **Markdown 工作空间** | 用户项目树：工具 **cwd**、生成媒体、项目 `.xopc/skills/`、任意用户文件。 |

下文默认状态根为 `~/.xopc/`；可用 `XOPC_STATE_DIR`、`XOPC_PROFILE`、`XOPC_HOME` 覆盖（见 [workspace.md 环境变量](workspace.md#环境变量速查)）。

## 状态目录（全局）

默认：`~/.xopc/`

| 路径 | 用途 |
|------|------|
| `xopc.json` | 主配置（若未用 `XOPC_CONFIG` / `XOPC_CONFIG_PATH` 指向他处）。 |
| `xopc.db` | 主 SQLite 数据库：会话、transcript、自动化、会话级配置、压缩检查点、FTS5 检索索引。 |
| `credentials/` | 全局密钥：`auth-profiles.json`、`oauth/<provider>.json`。 |
| `extensions/` | 已安装扩展、`extensions-lock.json`。 |
| `skills/` | 全局托管技能包（`<id>/SKILL.md`）。 |
| `logs/` | 应用日志（可用 `XOPC_LOG_DIR` 覆盖）。 |
| `bin/`、`tools/` | CLI 包装与工具运行时。 |
| `models.json` | 可选的自定义模型注册数据。 |
| `user/PROFILE.md` | 所有 Agent 共享的用户资料。 |
| `user/dreaming/` | Dreaming 运维事件日志；不作为记忆来源。 |

## 智能体主目录：`agents/<agentId>/`

由 `resolveAgentHomeDir(config, agentId)` 解析。常见结构：

| 路径 | 用途 |
|------|------|
| `profile/` | 智能体自身的系统提示用 profile Markdown：`SOUL.md`、`IDENTITY.md`、`TOOLS.md`、`AGENTS.md`、`HEARTBEAT.md`，以及网关可选 `agent-avatar.*`。全局个人资料位于 `user/PROFILE.md`。 |
| `sessions/` | 遗留目录（可选）；旧版安装可能仍存在。新安装仅将 transcript 写入 `xopc.db`。 |
| `inbound/` | 入站附件（非图片二进制）落盘；transcript 中相对路径为相对 agent home 的 `inbound/...`。 |
| `tts/` | 按会话缓存的出站 TTS 音频。 |
| `agent/` | 见下节 **智能体状态目录**。 |

种子：`xopc init` / `xopc agents add` 将缺失的 profile Markdown 模板复制到 **`agents/<agentId>/profile/`**（参见 [工作区模板](/zh/reference/templates)）。

## 智能体状态目录：`agents/<agentId>/agent/`

由 `resolveAgentDir(config, agentId)` 解析。

| 路径 | 用途 |
|------|------|
| `agent.json` | 智能体运行时元数据。 |
| `credentials/` | 各智能体 API 配置（如使用）。 |
| `inbox/pending/`、`inbox/processed/` | 基于文件的 IPC 收件箱。 |
| `pid`、`status.json`、`agent.sock` | 进程协调。 |
| `state/` | 机器状态（如 workspace 元数据、skills 扫描缓存）——**不是** Markdown 工作区下的 `.state/`。 |
| `extensions/` | 各智能体扩展安装根目录。 |
| `outbound-pending.json` | 出站消息崩溃恢复队列。 |

## Markdown 工作空间

由 `resolveAgentWorkspaceDir(config, agentId)` 根据所选 agent manifest 解析。当前配置通常使用 **`agents.list[].workspace.root`**（如 `~/.xopc/workspace/main`）；生成默认值时回退到 **`<stateDir>/workspace/<agentId>`**。

**预期内容**（用户可见 / 工具面向）：

| 路径 | 用途 |
|------|------|
| `memory/` | 按日或主题笔记（`YYYY-MM-DD.md`）；`memory_search` 等与工具 cwd。 |
| `media/generated/` | 生图等输出。 |
| `.xopc/skills/` | 项目本地用户自建技能。 |
| *任意文件* | `read` / `write` / `edit` 等工具操作对象。 |

新安装不会把内部状态写回 Markdown 工作区。本版本只支持文首表格中的 **单一目录树**：人设 Markdown 与机器状态按上表分布；**不会**从「全部堆在 Markdown 工作区里」的旧布局自动迁移；完整状态树用 `xopc init`，或 `xopc setup` / `xopc onboard` 做配置与 profile Markdown 种子，从其它 fork 升级时需自行搬迁数据。

会话里引用的入站附件 / TTS 路径仅支持相对 `inbound/`、`tts/`（相对 agent home 解析）。

## 运维辅助 API

- `listAgentWorkspaceDirs(config)` — 列出配置中各智能体的 Markdown 工作区根路径（CLI / 进阶用法）。
- `listAgentProfileMarkdownDirs(config)` — 与 `listAgentWorkspaceDirs` 相同根路径（profile Markdown 在工作区根；便于备份或外部编辑器挂载）。

## 另见

- [状态目录与工作空间布局](workspace.md) — 初始化、环境变量、模板文件说明。
- [架构设计](architecture.md) — 各组件如何使用上述路径。
- [会话管理](session.md) — 会话存储布局。
