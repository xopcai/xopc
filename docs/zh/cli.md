# CLI 命令参考

xopc 提供丰富的 CLI 命令用于管理、对话和配置。

## 使用方式

### 从 npm 安装（推荐）

```bash
# 全局安装
npm install -g @xopcai/xopc

# 直接使用命令
xopc <command>
```

### 从源码运行（开发）

```bash
# 克隆并安装
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install

# 使用 pnpm run dev -- 前缀
pnpm run dev -- <command>
```

**本文档中的命令示例默认使用 `xopc` 命令。** 如果你从源码运行，请将 `xopc` 替换为 `pnpm run dev --`。

---

## 命令列表

| 命令 | 描述 |
|------|------|
| `setup` | 初始化配置文件和工作区目录 |
| `onboard` | 交互式设置向导（LLM、渠道、Gateway） |
| `agents` | 管理 `config.json` 中的多个智能体（`agents.list`：列出、添加、删除） |
| `agent` | 与智能体对话 |
| `gateway` | 启动 REST 网关 |
| `cron` | 管理定时任务 |
| `extension` | 管理扩展 |
| `skills` | 管理技能（安装、启用、配置、测试） |
| `config` | 查看和编辑配置（非交互式） |
| `session` | 管理会话 |

---

## setup

仅初始化配置文件和工作区目录（无交互式提示）。

```bash
xopc setup
```

**参数**：

| 参数 | 描述 |
|------|------|
| `--workspace <path>` | 工作区目录路径（默认：~/.xopc/workspace） |

**示例**：

```bash
# 创建默认配置和工作区
xopc setup

# 自定义工作区路径
xopc setup --workspace ~/my-workspace
```

**功能**：
- 创建 `~/.xopc/xopc.json`（如果不存在）
- 创建工作区目录并生成引导文件（AGENTS.md、BOOTSTRAP.md 等）

---

## onboard

xopc 的交互式设置向导。这是设置 xopc 的推荐方式。

```bash
xopc onboard
```

**选项**：

| 选项 | 描述 |
|------|------|
| `--model` | 仅配置 LLM 服务商和模型 |
| `--channels` | 仅配置消息渠道 |
| `--gateway` | 仅配置 Gateway WebUI |
| `--all` | 配置所有内容（默认） |

**示例**：

```bash
# 完整交互式设置（默认）
xopc onboard

# 仅配置 LLM 模型
xopc onboard --model

# 仅配置渠道
xopc onboard --channels

# 仅配置 Gateway
xopc onboard --gateway
```

**功能**（不带选项时）：
- 自动检测是否需要设置工作区
- 配置 LLM 服务商和模型
- 配置消息渠道（Telegram）
- 配置 Gateway WebUI 并自动生成访问令牌
- 完成后显示启动网关的命令

---

## agents

管理 **`agents.list`**。工作区与 `~/.xopc/agents/<id>/` 等路径均由 **配置合并结果** 决定，**不再**使用独立于配置之外的 agent 注册表或 `XOPC_AGENT_ID` 环境变量。

| 子命令 | 说明 |
|--------|------|
| `agents list` | 列出已配置的 agent 与当前解析的默认 agent id（可加 `--json`）。 |
| `agents add <name>` | **必须**提供 `--workspace <dir>`。写入/更新 `agents.list`，创建目录并种子化 Markdown 引导文件。可选：`--model`、`--agent-dir`。 |
| `agents delete <id>` | 从 `list` 移除该 id，并清理相关的 **`bindings`**。加 **`--purge`** 时同时删除磁盘上的 agent 主目录与工作区（**不可**删除 `main`）。 |

示例：

```bash
xopc agents list
xopc agents add coder --workspace ~/xopc-workspaces/coder --model anthropic/claude-sonnet-4-5
xopc agents delete coder
xopc agents delete coder --purge
```

**Onboard 完成后**会显示：
- Gateway 访问 URL
- 访问令牌信息
- 启动网关的命令

**注意**：Gateway 默认在前台运行。按 `Ctrl+C` 停止，或使用 `xopc gateway stop` 从另一个终端停止。

---

## agent

与智能体对话。

### 单次对话

```bash
xopc agent -m "Hello, world!"
```

**参数**：

| 参数 | 描述 |
|------|------|
| `-m, --message` | 发送的消息 |
| `-s, --session` | 会话键 (默认: default) |
| `-i, --interactive` | 交互模式 |

### 交互模式

```bash
xopc agent -i
```

**使用**：

```
> Hello!
Bot: Hello! How can I help?

> List files
Bot: File listing...

> quit
```

### 指定会话

```bash
xopc agent -m "Continue our discussion" -s my-session
```

---

## gateway

启动 REST API 网关。

### 前台模式（默认）

```bash
xopc gateway --port 18790
```

网关默认在前台运行，按 `Ctrl+C` 停止。

**参数**：

| 参数 | 描述 |
|------|------|
| `-p, --port` | 端口号 (默认：18790) |
| `-h, --host` | 绑定地址 (默认：0.0.0.0) |
| `--token` | 认证令牌 |
| `--no-hot-reload` | 禁用配置热重载 |
| `--force` | 强制终止端口上的现有进程 |
| `--background` | 后台模式启动（分离进程） |

### 强制启动

如果端口已被占用，使用 `--force` 自动终止现有进程：

```bash
xopc gateway --force
```

这将发送 SIGTERM，等待 700ms，然后如需要发送 SIGKILL。

### 子命令

| 子命令 | 描述 |
|--------|------|
| `gateway status` | 查看网关运行状态 |
| `gateway stop` | 停止运行的网关 |
| `gateway restart` | 重启网关 |
| `gateway logs` | 查看网关日志 |
| `gateway token` | 查看/生成认证令牌 |
| `gateway install` | 安装为系统服务 |
| `gateway uninstall` | 卸载系统服务 |
| `gateway service-start` | 通过系统服务启动 |
| `gateway service-status` | 查看服务状态 |

**示例**：

```bash
# 查看状态
xopc gateway status

# 停止网关（SIGTERM，5秒超时）
xopc gateway stop

# 强制停止（立即 SIGKILL）
xopc gateway stop --force

# 重启网关（SIGUSR1 信号）
xopc gateway restart

# 强制重启（终止并重新启动）
xopc gateway restart --force

# 查看最近 50 行日志
xopc gateway logs

# 实时跟踪日志
xopc gateway logs --follow

# 生成新令牌
xopc gateway token --generate

# 安装为系统服务
xopc gateway install

# 卸载系统服务
xopc gateway uninstall

# 通过系统服务启动
xopc gateway service-start

# 查看服务状态
xopc gateway service-status
```

### 进程管理

- **锁文件**：`~/.xopc/locks/gateway.{hash}.lock`（替代 PID 文件）
- **信号**：SIGTERM/SIGINT=停止，SIGUSR1=重启
- **端口管理**：自动冲突检测和解决

**环境变量**：

| 变量 | 描述 |
|------|------|
| `XOPC_NO_RESPAWN` | 禁用进程重生 |
| `XOPC_ALLOW_SIGUSR1_RESTART` | 允许 SIGUSR1 重启 |
| `XOPC_SERVICE_MARKER` | 标记受监督环境 |

---

### 添加任务

```bash
xopc cron add --schedule "0 9 * * *" --message "Good morning!"
```

**参数**：

| 参数 | 描述 |
|------|------|
| `--schedule` | Cron 表达式 |
| `--message` | 定时发送的消息 |
| `--name` | 任务名称 (可选) |

**示例**：

```bash
# 每天 9 点
xopc cron add --schedule "0 9 * * *" --message "Daily update"

# 工作日 18 点
xopc cron add --schedule "0 18 * * 1-5" --message "Time to wrap up!"

# 每小时提醒
xopc cron add --schedule "0 * * * *" --message "Hourly reminder" --name hourly
```

### 删除任务

```bash
xopc cron remove <task-id>
```

**示例**：

```bash
xopc cron remove abc1
```

### 启用/禁用

```bash
xopc cron enable <task-id>
xopc cron disable <task-id>
```

### 触发任务

```bash
xopc cron trigger <task-id>
```

---

## extension

管理扩展。支持三级存储：workspace (./.extensions/) → global (~/.xopc/extensions/) → bundled。

### 列出扩展

```bash
xopc extension list
```

**输出示例**：
```
📦 Installed Extensions

══════════════════════════════════════════════════════════════════════

  📁 Workspace (./.extensions/)
    • My Custom Extension @ 0.1.0
      ID: my-custom-extension

  🌐 Global (~/.xopc/extensions/)
    • Telegram Channel @ 1.2.0
      ID: telegram-channel

  📦 Bundled (built-in)
    • Discord Channel @ 2.0.0
      ID: discord-channel
```

### 安装扩展

**从 npm 安装到 workspace**（默认）：
```bash
xopc extension install <package-name>

# 示例
xopc extension install xopc-extension-telegram
xopc extension install @scope/my-extension
xopc extension install my-extension@1.0.0
```

**安装到 global**（跨项目共享）：
```bash
xopc extension install <package-name> --global

# 示例
xopc extension install xopc-extension-telegram --global
```

**从本地目录安装**：
```bash
# 安装到 workspace
xopc extension install ./my-local-extension

# 安装到 global
xopc extension install ./my-local-extension --global
```

**参数**：

| 参数 | 描述 |
|------|------|
| `--global` | 安装到全局目录 (~/.xopc/extensions/) |
| `--timeout <ms>` | 安装超时时间（默认 120000ms） |

**安装流程**：
1. 下载/复制扩展文件
2. 验证 `xopc.extension.json` 清单
3. 安装依赖（如有 `package.json` 依赖）
4. 复制到目标目录 (workspace/.extensions/ 或 ~/.xopc/extensions/)

**三级存储说明**：
- Workspace (./.extensions/)：项目私有，优先级最高
- Global (~/.xopc/extensions/)：用户级共享
- Bundled：内置扩展，优先级最低

### 移除扩展

```bash
xopc extension remove <extension-id>
# 或
xopc extension uninstall <extension-id>
```

**示例**：
```bash
xopc extension remove telegram-channel
```

**注意**：
- 优先从 workspace 移除，如不存在则从 global 移除
- 移除后如果已启用，还需要从配置文件中删除

### 查看扩展详情

```bash
xopc extension info <extension-id>
```

**示例**：
```bash
xopc extension info telegram-channel
```

**输出**：
```
📦 Extension: Telegram Channel

  ID: telegram-channel
  Version: 1.2.0
  Kind: channel
  Description: Telegram channel integration
  Path: /home/user/.xopc/workspace/.extensions/telegram-channel
```

### 创建扩展

创建新插件脚手架。

```bash
xopc extension create <extension-id> [options]
```

**参数**：

| 参数 | 描述 |
|------|------|
| `--name <name>` | 扩展显示名称 |
| `--description <desc>` | 扩展描述 |
| `--kind <kind>` | 扩展类型: `channel`, `provider`, `memory`, `tool`, `utility` |

**示例**：

```bash
# 创建工具类插件
xopc extension create weather-tool --name "Weather Tool" --kind tool

# 创建通道类插件
xopc extension create discord-channel --name "Discord Channel" --kind channel

# 创建内存类插件
xopc extension create redis-memory --name "Redis Memory" --kind memory
```

**生成的文件**：
```
.extensions/
└── my-extension/
    ├── package.json          # npm 配置
    ├── index.ts              # 扩展入口（TypeScript）
    ├── xopc.extension.json   # 扩展清单
    └── README.md             # 文档模板
```

**注意**：创建的扩展使用 TypeScript，通过 [jiti](https://github.com/unjs/jiti) 即时加载，无需预编译。

---

## 全局选项

### 工作区路径

```bash
--workspace /path/to/workspace
```

### 配置文件

```bash
--config /path/to/config.json
```

### 详细输出

```bash
--verbose
```

### 帮助信息

```bash
xopc --help
xopc agent --help
xopc gateway --help
xopc extension --help
```

---

## skills

管理技能的 CLI 命令。

### 列出技能

```bash
xopc skills list
xopc skills list -v          # 详细信息
xopc skills list --json      # JSON 格式
```

### 安装技能依赖

```bash
xopc skills install <skill-name>
xopc skills install <skill-name> -i <install-id>   # 指定安装器
xopc skills install <skill-name> --dry-run         # 预演
```

### 启用/禁用技能

```bash
xopc skills enable <skill-name>
xopc skills disable <skill-name>
```

### 查看技能状态

```bash
xopc skills status
xopc skills status <skill-name>
xopc skills status --json
```

### 安全审计

```bash
xopc skills audit
xopc skills audit <skill-name>
xopc skills audit <skill-name> --deep    # 详细输出
```

### 配置技能

```bash
xopc skills config <skill-name> --show
xopc skills config <skill-name> --api-key=KEY
xopc skills config <skill-name> --env KEY=value
```

### 测试技能

```bash
# 测试所有技能
xopc skills test

# 测试特定技能
xopc skills test <skill-name>

# 详细输出
xopc skills test --verbose

# JSON 格式
xopc skills test --format json

# 跳过特定测试
xopc skills test --skip-security
xopc skills test --skip-examples

# 验证 SKILL.md 文件
xopc skills test validate ./skills/weather/SKILL.md

# 检查依赖
xopc skills test check-deps

# 安全审计
xopc skills test security --deep
```

**测试输出格式**：

| 格式 | 说明 |
|------|------|
| `text` | 人类可读的文本输出（默认） |
| `json` | JSON 格式，用于机器读取 |
| `tap` | TAP 格式，用于 CI/CD 集成 |

**测试类型**：

| 测试 | 说明 |
|------|------|
| SKILL.md 格式 | 验证 YAML frontmatter 和必需字段 |
| 依赖检查 | 检查声明的二进制文件是否可用 |
| 安全扫描 | 扫描危险代码模式 |
| 元数据完整性 | 检查 emoji、homepage 等可选字段 |
| 示例验证 | 验证代码块语法 |

---

## 快捷脚本

创建快捷脚本 `bot`：

```bash
#!/bin/bash

case "$1" in
  chat)
    xopc agent -m "${*:2}"
    ;;
  shell)
    xopc agent -i
    ;;
  start)
    xopc gateway --port 18790
    ;;
  cron)
    shift
    xopc cron "$@"
    ;;
  extension)
    shift
    xopc extension "$@"
    ;;
  skills)
    shift
    xopc skills "$@"
    ;;
  *)
    echo "Usage: bot {chat|shell|start|cron|extension|skills}"
    ;;
esac
```

使用：

```bash
bot chat Hello!
bot start
bot cron list
bot extension list
bot extension install xopc-extension-telegram
bot skills list
bot skills test weather
```

---

## 退出码

| 退出码 | 描述 |
|--------|------|
| `0` | 成功 |
| `1` | 通用错误 |
| `2` | 参数错误 |
| `3` | 配置错误 |
