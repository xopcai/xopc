# 状态目录与工作空间布局

**bootstrap、agent 主目录与 Markdown 工作区**的简明路径表见 [磁盘与目录布局](disk-layout.md)。

xopc 在单一 **状态目录**（“Agent OS” 根）下保存本机状态；其下有 **按智能体划分** 的目录树（会话、收件箱、入站/TTS、托管记忆、运行时文件等）。**工作空间（workspace）** 是 Markdown 根目录：工具 `cwd`、按日的 `memory/` 笔记、用户文件，以及其下的扩展安装路径。

路径由 **主配置文件**（默认 `<状态目录>/xopc.json`）及环境变量决定。**`xopc init`** 与 **`xopc agents add`** 会创建目录并写入模板。**Markdown 工作区**（工具 `cwd` 与项目文件）与 **`agents/<id>/` 状态目录** 不是同一棵树：默认在状态根旁的 `workspace` / `workspace-<id>`，或按 **`agents.defaults.workspace/<id>`** 解析。

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
| `xopc.json` | 主配置（服务商、网关、通道、`agents.defaults` 等）。 |
| `credentials/` | 全局凭据；`auth-profiles.json`；OAuth 令牌 `oauth/<provider>.json`。 |
| `extensions/` | 已安装扩展与 `extensions-lock.json`。 |
| `skills/` | 技能包目录（每个技能为含 `SKILL.md` 的文件夹）。 |
| `cron/` | `jobs.json` 定时任务；`logs/` 按日 JSONL；`runs/` 按任务运行历史。 |
| `logs/` | 进程日志（`xopc-<date>.log`），可被 `XOPC_LOG_DIR` 覆盖。 |
| `bin/` | 托管的 CLI 包装（如 `xopc`）。 |
| `tools/` | 内置工具运行时（例如 `tools/node/current/` 下的 Node/npm）。 |
| `models.json` | 模型注册表缓存。 |

## 按 Agent：`agents/<agentId>/`

给定 **`agentId`** 时，**agent 主目录**默认为 `~/.xopc/agents/<id>/`（仍受上文 `XOPC_STATE_DIR` / profile 规则约束）。配置项 **`agents.list[].agentDir`** 可覆盖 **内部 agent 状态目录**（`…/agent` 子树：凭证、`agent.json`、收件箱、pid/socket 等）。

| 路径 | 作用 |
|------|------|
| `sessions/` | 会话存储：分片 transcript、`index.json`、`archive/` 归档目录。 |
| `agent/` | **agent 状态目录**（非 Markdown 工作区）：`agent.json`、`credentials/`、文件收件箱（`inbox/pending`、`inbox/processed`）及易失文件（`pid`、`status.json`、`agent.sock`），**无**单独顶层 `run/`。 |

会话数据 **不在** Markdown 工作空间目录下，固定使用 `agents/<agentId>/sessions/`。

## 工作空间目录（Markdown 根）

在常规配置下，每个智能体可有显式 **`workspace`**，或继承 **`agents.defaults.workspace/<agentId>`**，否则回退到状态目录旁的 `workspace` / `workspace-<id>`。

CLI **未**加载到配置文件时，优先 **`XOPC_WORKSPACE`**；否则主 Markdown 树默认可用 **`~/.xopc/workspace`**。**`xopc init`** 会创建 **`agents/<id>/`**、Markdown 工作区，并按 [工作区模板](/zh/reference/templates) 中的文件名种子化引导文件（仅当文件尚不存在时写入）。**`xopc agents add`** 更新 **`agents.list`** 并初始化新工作区（见 [CLI](cli.md#agents)）。

### 引导用 Markdown（人格与记忆索引）

这些文件按 **固定顺序** 进入系统提示（有长度限制），在各智能体的 `bootstrap/` 下编辑。

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

按会话的配置覆盖（`sessions/config/` 下的 JSON）、**入站**附件（`inbound/`）、**TTS** 缓存（`tts/`）与 **托管** 存储（`memories/`）均在 **`agents/<agentId>/`**（agent 主目录）下，不在本 Markdown 树内。

### 托管记忆（`agents/<agentId>/memories/`） {#curated-memory}

与 `agents/<id>/bootstrap/` 下的引导用 `MEMORY.md` 以及工作区内可检索的 `memory/*.md` 不同，**`agents/<agentId>/memories/`** 使用 **`MEMORY.md`（助手笔记）** 与 **`USER.md`（用户画像）** 存放 **有上限、以 § 分隔** 的条目。在启用增强记忆时，会话开始会注入 **冻结快照**；运行中可通过 **`curated_memory`** 工具读写磁盘上的最新内容。开关与字符上限见 **`agents.defaults.memory`**（[配置参考](configuration.md)）。

## 运行时到底用哪个「工作空间」？

相关但不同来源的两套逻辑：

1. **网关** — 使用配置中的 **默认智能体** 及其解析后的 Markdown 工作区；该工作区下的 **`.extensions`** 供工作区级扩展使用（若存在）。

2. **CLI**（根命令未传 `--workspace` 时）— 优先 **`XOPC_WORKSPACE`**，否则与上相同的 **`~/.xopc/workspace`** 启发式默认。

`xopc init` 后，`main` 的引导文件默认在 `~/.xopc/workspace/`；若希望网关与 CLI 使用同一套 Markdown，请将 **`agents.defaults.workspace`**（及任意 **`agents.list[].workspace`**）指向同一路径。

## 环境变量速查

| 变量 | 作用 |
|------|------|
| `XOPC_STATE_DIR` | 状态根目录 |
| `XOPC_PROFILE` | 按 profile 的状态目录 |
| `XOPC_HOME` | 默认状态路径中的家目录 |
| `XOPC_CONFIG` / `XOPC_CONFIG_PATH` | 配置文件路径 |
| `XOPC_WORKSPACE` | 未指定 `--workspace` 时 CLI 使用的默认 Markdown 工作区 |
| `XOPC_CREDENTIALS_DIR` | 全局凭据目录 |
| `XOPC_LOG_DIR` | 日志目录 |

## 另见

- [工作空间模板](reference/templates.md) — 各 Markdown 模板说明
- [会话管理](session.md) — 会话位于 `agents/<id>/sessions/`
- [架构设计](architecture.md) — 组件如何消费这些路径
