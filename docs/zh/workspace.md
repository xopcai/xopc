# 状态目录与工作空间布局

**bootstrap、agent 主目录与 Markdown 工作区**的简明路径表见 [磁盘与目录布局](disk-layout.md)。

xopc 在单一 **状态目录**（“Agent OS” 根）下保存本机状态；其下有 **按 Agent 划分** 的目录树（会话、收件箱、入站/TTS、托管记忆、运行时文件等）。**工作空间（workspace）** 是 Markdown 根目录：工具 `cwd`、按日的 `memory/` 笔记、用户文件，以及其下的扩展安装路径。

路径以 **`config.json` 为唯一事实来源**：`src/agent/agent-scope.ts`（workspace / agentDir 解析），以及 `src/config/paths-state.ts`、`src/config/workspace-defaults.ts`、`src/config/paths.ts`。目录骨架由 **`xopc init`**（`src/cli/commands/init.ts`）与 **`xopc agents add`** 创建/更新。**Markdown 工作区**不在 `agents/<id>/` 下（默认在状态根旁的 `workspace` / `workspace-<id>`，或配置为 `agents.defaults.workspace/<id>`）。

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

多 Agent 共享（除非另有说明）。

| 路径 | 作用 |
|------|------|
| `xopc.json` | 主配置（提供商、网关、通道、`agents.defaults` 等）。 |
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

无配置中逐条 `workspace` 覆盖时的启发式路径：默认 agent → `<stateDir>/workspace`；其它 id → `<stateDir>/workspace-<id>`（未设置 `agents.defaults.workspace` 时）。载入 **`config.json`** 时，以合并后的 `resolveAgentWorkspaceDir` / 有效 Agent 配置为准：显式 `workspace`、`join(agents.defaults.workspace, id)`，或回退到 `workspace-<id>`。

未加载配置时，CLI 默认使用 **`resolveDefaultAgentWorkspaceDir()`**（`src/config/workspace-defaults.ts`）：若设置 `XOPC_WORKSPACE` 则用之，否则对主工作区启发式为 `~/.xopc/workspace`。**`xopc init`** 会加载配置（或 schema 默认值），创建 **`agents/<id>/`** 与解析得到的 Markdown 工作区，并按内置模板**种子化**标准引导 Markdown（与 [工作区模板](/zh/reference/templates) 一致：`SOUL.md`、`IDENTITY.md`、`USER.md`、`TOOLS.md`、`AGENTS.md`、`HEARTBEAT.md`、`MEMORY.md` 及模板包中的 `BOOTSTRAP.md`）。仅当目标文件尚不存在时才写入。**`xopc agents add`** 会更新 **`agents.list`**、创建目录并种子化新工作区，用于新增多 Agent（见 [CLI](cli.md#agents)）。

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

按会话的配置覆盖（`sessions/config/` 下的 JSON）、**入站**附件（`inbound/`）、**TTS** 缓存（`tts/`）与 **托管** 存储（`memories/`）均在 **`agents/<agentId>/`**（agent 主目录）下，不在本 Markdown 树内。

### 托管记忆（`agents/<agentId>/memories/`） {#curated-memory}

与 `agents/<id>/bootstrap/` 下的引导用 `MEMORY.md` 以及工作区内可检索的 `memory/*.md` 不同，**`agents/<agentId>/memories/`** 使用 **`MEMORY.md`（助手笔记）** 与 **`USER.md`（用户画像）** 存放 **有上限、以 § 分隔** 的条目。在启用增强记忆时，会话开始会注入 **冻结快照**；运行中可通过 **`curated_memory`** 工具读写磁盘上的最新内容。开关与字符上限见 **`agents.defaults.memory`**（[配置参考](configuration.md)）。

## 运行时到底用哪个「工作空间」？

相关但不同来源的两套逻辑：

1. **合并后的默认 agent 工作区** — **网关** 与 `getWorkspacePath(config)`（`src/config/schema.ts`）根据配置解析**默认 agent id**，再通过 `resolveAgentWorkspaceDir` / 有效 profile 得到 Markdown 根路径。网关扩展目录为 `<该 workspace>/.extensions`。

2. **CLI 默认上下文**（根命令未显式传 `--workspace` 时）— 若设置 `XOPC_WORKSPACE` 则用之，否则 **`resolveDefaultAgentWorkspaceDir()`** → 在状态目录启发式下为 `~/.xopc/workspace`（`src/cli/registry.ts`、`src/config/workspace-defaults.ts`）。

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
