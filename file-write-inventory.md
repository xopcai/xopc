# xopcbot File Write Inventory

> 记录 xopcbot 运行时所有写入磁盘的文件和目录，包括路径、作用和来源。
>
> Last updated: 2026-04-10

---

## 一、`~/.xopcbot/`（stateDir — 全局状态目录）

| 路径 | 文件/目录 | 作用 | 来源 |
|------|-----------|------|------|
| `~/.xopcbot/xopcbot.json` | 主配置文件 | 全局配置（providers、agents、channels 等） | `config/loader.ts` |
| `~/.xopcbot/models.json` | 自定义模型配置 | 自定义 provider/model 定义（Ollama、vLLM 等） | `config/models-json.ts` |
| `~/.xopcbot/credentials/auth-profiles.json` | 全局 API Key 存储 | 所有 provider 的 API Key profiles | `auth/credentials.ts` |
| `~/.xopcbot/credentials/oauth/<provider>.json` | OAuth Token | 各 provider 的 OAuth 令牌 | `auth/credentials.ts` |
| `~/.xopcbot/extensions/` | 全局扩展目录 | 全局安装的扩展包 | `extensions/install.ts` |
| `~/.xopcbot/extensions/extensions-lock.json` | 扩展锁文件 | 扩展版本锁定 | `extensions/lockfile.ts` |
| `~/.xopcbot/skills/<id>/SKILL.md` | 全局 Skills | 通过 gateway API 安装的 skill 包 | `agent/skills/managed-store.ts` |
| `~/.xopcbot/cron/jobs.json` | Cron 任务配置 | 定时任务定义 | `cron/persistence.ts` |
| `~/.xopcbot/cron/logs/<date>.jsonl` | Cron 日志（旧） | 旧版 cron 日志 | `config/paths.ts` |
| `~/.xopcbot/cron/runs/<jobId>.jsonl` | Cron 运行历史 | 每个 job 的执行历史（append-only JSONL） | `cron/run-log-store.ts` |
| `~/.xopcbot/logs/xopcbot-<date>.log` | 应用日志 | 运行时日志（pino JSON 格式） | `utils/logger/streams.ts` |
| `~/.xopcbot/logs/xopcbot-<date>.log.gz` | 压缩日志 | 轮转后的压缩日志 | `utils/logger/rotation.ts` |
| `~/.xopcbot/logs/audit-<date>.log` | 审计日志 | 安全审计事件 | `utils/logger/audit.ts` |
| `~/.xopcbot/logs/gateway.log` | Gateway stdout | daemon 模式下 gateway 的标准输出 | `daemon/launchd.ts` |
| `~/.xopcbot/logs/gateway.err.log` | Gateway stderr | daemon 模式下 gateway 的错误输出 | `daemon/launchd.ts` |
| `~/.xopcbot/bin/xopcbot` | CLI 二进制软链 | xopcbot CLI 可执行文件 | `config/paths.ts` |
| `~/.xopcbot/tools/node/` | Node.js 工具 | 内置 Node.js 运行时 | `config/paths.ts` |
| `~/.xopcbot/locks/gateway.<hash>.lock` | Gateway 锁文件 | 防止多实例 gateway 同时运行 | `gateway/lock.ts` |

---

## 二、`~/.xopcbot/agents/<id>/`（agentHomeDir — agent 主目录）

| 路径 | 文件/目录 | 作用 | 来源 |
|------|-----------|------|------|
| `agent/agent.json` | Agent 元数据 | agent 的 id、创建时间、版本等元信息 | `cli/commands/init.ts` |
| `agent/pid` | PID 文件 | 当前运行的 agent 进程 ID | `config/paths.ts` |
| `agent/status.json` | 状态文件 | agent 当前运行状态 | `config/paths.ts` |
| `agent/agent.sock` | Unix Socket | agent IPC 通信套接字（进程间通信） | `agent/ipc/socket.ts` |
| `agent/inbox/pending/<id>.json` | 待处理 IPC 消息 | 文件系统 IPC 消息队列（待处理） | `agent/ipc/inbox.ts` |
| `agent/inbox/processed/<id>.json` | 已处理 IPC 消息 | 文件系统 IPC 消息队列（已处理） | `agent/ipc/inbox.ts` |
| `agent/credentials/auth-profiles.json` | Agent 私有 API Keys | agent 专属的 provider credentials | `auth/credentials.ts` |
| `sessions/index.json` | 会话索引 | 所有会话的元数据索引（状态、消息数、时间等） | `session/store.ts` |
| `sessions/<shard>/<sessionKey>.json` | 会话 transcript | 对话消息记录（JSONL 格式） | `session/store.ts` |
| `sessions/<shard>/<sessionKey>.meta.json` | 会话元数据 | 单个会话的扩展元数据 | `session/store.ts` |
| `sessions/archive/<shard>/<key>.<ts>.json` | 归档会话 | 归档的历史会话 | `session/store.ts` |

---

## 三、`workspace/`（用户工作区 — 用户可见内容）

### 3.1 Bootstrap Markdown 文件（agent 人格/配置，用户可编辑）

| 路径 | 作用 | 来源 |
|------|------|------|
| `SOUL.md` | Agent 人格与价值观定义 | `cli/commands/init.ts` |
| `IDENTITY.md` | Agent 身份描述 | `cli/commands/init.ts` |
| `USER.md` | 用户信息（workspace 根级，旧版） | `cli/commands/init.ts` |
| `AGENTS.md` | Agent 行为指南 | `cli/commands/init.ts` |
| `TOOLS.md` | 可用工具说明 | `cli/commands/init.ts` |
| `HEARTBEAT.md` | Heartbeat 任务配置 | `cli/commands/init.ts` |
| `MEMORY.md` | 长期记忆（workspace 根级，旧版） | `cli/commands/init.ts` |
| `CONTEXT.md` | 上下文信息 | `cli/commands/init.ts` |
| `SKILLS.md` | Skills 配置说明 | `cli/commands/init.ts` |
| `BOOTSTRAP.md` | 启动引导文件 | `agent/context/workspace-seed.ts` |

### 3.2 用户产生的内容

| 路径 | 作用 | 来源 |
|------|------|------|
| `memory/YYYY-MM-DD.md` | 每日记忆日志 | `config/paths.ts` → `resolveMemoryPath` |
| `media/generated/` | AI 生图输出 | `agent/tools/image-generate-tool.ts` |
| `skills/` | 用户自定义 skills | `agent/skills/index.ts` |
| *(任意用户文件)* | agent write/edit 工具写入的文件 | `agent/tools/write.ts`, `agent/tools/edit.ts` |

### 3.3 ⚠️ Agent 内部状态（当前混入 workspace，应迁移）

以下路径是 agent 运行时自动产生的内部状态，用户不应感知，放在 workspace 下会污染用户的工作目录，**建议迁移到 agentHomeDir**。

| 当前路径（workspace 下） | 作用 | 来源 | 建议迁移到 |
|--------------------------|------|------|-----------|
| `.xopcbot/memories/MEMORY.md` | Agent 精选记忆（结构化，§ 分隔） | `agent/memory/builtin-memory-store.ts` | `agentHomeDir/memories/` |
| `.xopcbot/memories/USER.md` | 用户画像（agent 管理） | `agent/memory/builtin-memory-store.ts` | `agentHomeDir/memories/` |
| `.xopcbot/inbound/<session>/` | 入站附件落盘（非图片文件） | `channels/attachments/inbound-persist.ts` | `agentHomeDir/inbound/` |
| `.xopcbot/tts/<session>/` | 出站 TTS 音频缓存 | `channels/attachments/outbound-tts-persist.ts` | `agentHomeDir/tts/` |
| `.xopcbot/outbound-pending.json` | 出站消息崩溃恢复队列 | `channels/outbound/persist-store.ts` | `agentDir/outbound-pending.json` |
| `.sessions/config/<session>.json` | 会话级运行时配置（thinking level、model override 等） | `session/config-store.ts` | `agentHomeDir/sessions/config/` |
| `.sessions/acp-sessions.json` | ACP 会话元数据索引 | `acp/control-plane/session-store.ts` | `agentHomeDir/sessions/` |
| `.state/workspace.json` | Workspace 状态元数据 | `config/paths.ts` → `resolveWorkspaceStatePath` | `agentDir/state/` |
| `.state/skills-cache.json` | Skills 扫描缓存 | `config/paths.ts` → `resolveSkillsCachePath` | `agentDir/state/` |
| `.extensions/<id>/` | Agent 加载的扩展安装目录 | `extensions/install.ts` | `agentDir/extensions/` |

---

## 四、系统级（非 xopcbot 目录）

| 路径 | 作用 | 来源 |
|------|------|------|
| `~/Library/LaunchAgents/ai.xopcbot.gateway.plist` | macOS 开机自启 plist | `daemon/launchd.ts` |
| `~/.config/systemd/user/xopcbot-gateway.service` | Linux systemd 服务 | `daemon/systemd.ts` |
| `/tmp/input_<ts>.wav` / `/tmp/output_<ts>.opus` | TTS 音频临时文件（用后删除） | `tts/audio.ts` |

---

## 五、待迁移路径汇总

以下 10 个 workspace 下的路径全部是 agent 运行时内部状态，应从 workspace 迁移到 agentHomeDir：

```
workspace/.xopcbot/memories/          → agentHomeDir/memories/
workspace/.xopcbot/inbound/           → agentHomeDir/inbound/
workspace/.xopcbot/tts/               → agentHomeDir/tts/
workspace/.xopcbot/outbound-pending.json → agentDir/outbound-pending.json
workspace/.sessions/config/           → agentHomeDir/sessions/config/
workspace/.sessions/acp-sessions.json → agentHomeDir/sessions/acp-sessions.json
workspace/.state/workspace.json       → agentDir/state/workspace.json
workspace/.state/skills-cache.json    → agentDir/state/skills-cache.json
workspace/.extensions/                → agentDir/extensions/
```
