# 状态目录与工作空间布局

**profile Markdown、agent 主目录与 Markdown 工作区**的简明路径表见 [磁盘与目录布局](disk-layout.md)。

xopc 在单一 **状态目录**（“Agent OS” 根）下保存本机状态；其中 `user/` 保存所有 Agent 共享的用户上下文，按 Agent 划分的目录只保存 profile、收件箱、入站/TTS 与运行时文件。**会话 transcript** 存储在状态根下的 **`xopc.db`**（SQLite）。**工作空间（workspace）** 是 Markdown 根目录：工具 `cwd`、按日的 `memory/` 笔记、用户文件，以及其下的扩展安装路径。

路径由 **主配置文件**（默认 `<状态目录>/xopc.json`）及环境变量决定。**`xopc init`** 与 **`xopc agents add`** 会创建目录并写入模板。**Markdown 工作区**（工具 `cwd` 与项目文件）与 **`agents/<id>/` 状态目录** 不是同一棵树：当前配置通常由 **`agents.list[].workspace.root`** 显式指定；生成默认值时回退到 **`<状态目录>/workspace/<agentId>/`**（默认智能体 id 为 `main`）。

## 状态目录根

默认：`~/.xopc`  
覆盖优先级（从高到低）：

| 方式 | 结果 |
|------|------|
| `XOPC_STATE_DIR` | 显式指定状态根目录 |
| `XOPC_PROFILE` | 当值存在且不为 `default` 时使用 `~/.xopc-<profile>` |
| `XOPC_HOME` | 默认路径中的「家目录」基底（`$XOPC_HOME/.xopc`） |

主配置文件为状态目录下的 `xopc.json`；若设置 `XOPC_CONFIG` / `XOPC_CONFIG_PATH` 则指向该文件。

## 全局目录（状态根下）

多智能体共享（除非另有说明）。

| 路径 | 作用 |
|------|------|
| `xopc.json` | 主配置（服务商、网关、通道、`agents.list`、`agents.capabilityPresets` 等）。 |
| `xopc.db` | SQLite 数据库：会话、transcript、自动化、会话级配置、压缩检查点、FTS5 检索。 |
| `credentials/` | 全局凭据；`auth-profiles.json`；OAuth 令牌 `oauth/<provider>.json`。 |
| `extensions/` | 已安装扩展与 `extensions-lock.json`。 |
| `skills/` | 技能包目录（每个技能为含 `SKILL.md` 的文件夹）。 |
| `logs/` | 进程日志（`xopc-<date>.log`），可被 `XOPC_LOG_DIR` 覆盖。 |
| `bin/` | 托管的 CLI 包装（如 `xopc`）。 |
| `tools/` | 内置工具运行时（例如 `tools/node/current/` 下的 Node/npm）。 |
| `models.json` | 模型注册表缓存。 |

## 按 Agent：`agents/<agentId>/`

给定 **`agentId`** 时，**agent 主目录**默认为 `~/.xopc/agents/<id>/`（仍受上文 `XOPC_STATE_DIR` / profile 规则约束）。配置项 **`agents.list[].agentDir`** 可覆盖 **内部 agent 状态目录**（`…/agent` 子树：凭证、`agent.json`、收件箱、pid/socket 等）。

| 路径 | 作用 |
|------|------|
| `agent/` | **agent 状态目录**（非 Markdown 工作区）：`agent.json`、`credentials/`、文件收件箱（`inbox/pending`、`inbox/processed`）及易失文件（`pid`、`status.json`、`agent.sock`），**无**单独顶层 `run/`。 |

会话元数据与 transcript 存储在 **`~/.xopc/xopc.db`**（SQLite）中。

## 工作空间目录（Markdown 根）

在常规配置下，每个智能体通过 **`agents.list[].workspace.root`** 指定 Markdown 工作区；未能从配置解析时回退到 **`<状态目录>/workspace/<agentId>`**。

CLI **未**加载到配置文件时，优先 **`XOPC_WORKSPACE`**（主智能体 Markdown 根的完整路径）；否则主 Markdown 树默认为 **`<状态目录>/workspace/main`**。**`xopc init`** 会创建 **`agents/<id>/`**、Markdown 工作区，并按 [工作区模板](/zh/reference/templates) 将缺失的 profile 文件写入 **`agents/<id>/profile/`**（仅当文件尚不存在时）。**`xopc agents add`** 更新 **`agents.list`** 并初始化目录与 profile 种子（见 [CLI](cli.md#agents)）。

### 引导用 Markdown（Agent 人格）

这些文件按 **固定顺序** 进入系统提示（有长度限制）。路径：**`agents/<agentId>/profile/`**（文件名不变）。

| 文件 | 作用 |
|------|------|
| `SOUL.md` | 原则与「你是谁」。 |
| `IDENTITY.md` | 名称、描述、语言、头像、语气与边界；这是 UI 展示身份和模型实际读取身份的唯一来源。 |
| `TOOLS.md` | 环境相关的工具提示（主机、设备等）。 |
| `AGENTS.md` | 安全与协作规范。 |
| `HEARTBEAT.md` | 心跳 / 主动巡检配置（空或仅注释则跳过相关调用）。 |
记忆不属于 Agent profile。共享用户上下文以结构化数据保存在 `xopc.db`，并由顶层 `userContext` 控制。

根目录下的其他 Markdown（例如 `CONTEXT.md`、`SKILLS.md`）为可选，**默认不会**写入系统提示；需自行通过工具读取或自定义流程使用。

### 子目录与点目录

| 路径 | 作用 |
|------|------|
| `.state/` | 机器状态：`workspace.json`（引导种子信息）、`skills-cache.json` 等。 |
| `.extensions/` | 与工作空间绑定的扩展安装/缓存（扩展加载器使用）。 |

按会话的配置覆盖（SQLite `session_config`）、**入站**附件（`inbound/`）、**TTS** 缓存（`tts/`）和结构化记忆与 **`agents/<agentId>/`**（agent 主目录）或 **`xopc.db`** 相关，不在本 Markdown 树内。

### 结构化用户理解

用户资料、可审核理解、协作约定、证据、逐轮选择、授权与反馈统一保存在 SQLite 中。每轮只选择经过作用域、敏感性、授权和预算过滤的相关子集；工作区 Markdown 不参与用户记忆。

## 运行时到底用哪个「工作空间」？

相关但不同来源的两套逻辑：

1. **网关** — 使用配置中的 **默认智能体** 及其解析后的 Markdown 工作区；该工作区下的 **`.extensions`** 供工作区级扩展使用（若存在）。

2. **CLI**（根命令未传 `--workspace` 时）— 优先 **`XOPC_WORKSPACE`**，否则 **`<状态目录>/workspace/main`**（或等价 profile 路径）。

`xopc init` 后，`main` 的 profile Markdown 默认在 **`~/.xopc/agents/main/profile/`**；Markdown 工作区是所选 manifest 的 **`workspace.root`**，常见为 `~/.xopc/workspace/main`。列表项 **`agents.list[].workspace.root`** 仅覆盖该智能体的 **Markdown** 解析路径。

## 环境变量速查

| 变量 | 作用 |
|------|------|
| `XOPC_STATE_DIR` | 状态根目录 |
| `XOPC_PROFILE` | 按 profile 的状态目录 |
| `XOPC_HOME` | 默认状态路径中的家目录 |
| `XOPC_CONFIG` / `XOPC_CONFIG_PATH` | 配置文件路径 |
| `XOPC_WORKSPACE` | 未指定 `--workspace` 时主智能体 Markdown 根的完整路径 |
| `XOPC_CREDENTIALS_DIR` | 全局凭据目录 |
| `XOPC_LOG_DIR` | 日志目录 |

### 状态 Profile（CLI）

使用 **`xopc profile`** 管理独立状态根（`default` 为 `~/.xopc`，其它为 `~/.xopc-<name>`）：

```bash
xopc profile list
xopc profile create staging
xopc profile switch staging   # 输出 export XOPC_PROFILE=staging
```

## 另见

- [工作空间模板](reference/templates.md) — 各 Markdown 模板说明
- [会话管理](session.md) — 会话元数据和转录记录存储在 `~/.xopc/xopc.db`（SQLite）中
- [架构设计](architecture.md) — 组件如何消费这些路径
