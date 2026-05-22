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
| `channels` | 渠道登录（`channels login`）与私聊配对批准（`channels pairing approve`） |
| `agents` | 管理 `config.json` 中的多个智能体（`agents.list`：列出、添加、删除） |
| `agent` | 与智能体对话 |
| `tui` | 全屏终端对话界面（连网关或 `--local` 嵌入式）— 详见 [TUI](./tui.md) |
| `gateway` | 启动 REST 网关 |
| `cron` | 管理定时任务 |
| `extension` | 管理扩展 |
| `skills` | 管理技能（安装、启用、配置、测试） |
| `mcp` | 管理 MCP 服务器（`list`、`show`、`set`、`unset`、`serve`）— 见 [MCP](./mcp.md) |
| `config` | 查看和编辑配置（非交互式） |
| `image` | 图像理解 / 文生图默认项（`status`、`set-understanding`、`set-generation`、备用链、`providers` 等） |
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
| `--workspace <path>` | 主智能体 Markdown 根路径（无配置时默认：`~/.xopc/workspace/main`） |

**示例**：

```bash
# 创建默认配置和工作区
xopc setup

# 自定义工作区路径
xopc setup --workspace ~/my-workspace
```

**功能**：
- 创建 `~/.xopc/xopc.json`（如果不存在）
- 创建工作区目录并在 `agents/<id>/profile/` 生成引导文件（AGENTS.md、BOOTSTRAP.md 等）

---

## onboard

xopc 的交互式设置向导。Gateway 绑定/端口/令牌沿用配置默认值（`127.0.0.1:18790`，token 缺失时自动生成），向导中不再逐项询问。

```bash
xopc onboard
```

**选项**：

| 选项 | 描述 |
|------|------|
| `--model` | 仅配置 LLM 服务商和模型 |
| `--channels` | 仅配置消息渠道 |
| `--gateway` | 静默应用默认 Gateway 设置 |
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
- 配置消息渠道（Telegram、在渠道菜单中可选 Weixin 扫码等）
- 应用 Gateway 默认设置（令牌缺失则自动生成）
- 交互结束前可选择：**终端 UI（本地嵌入）**、**后台启动 Gateway**，或稍后手动启动

---

## channels

在运行 CLI 的机器上（与网关同机时才能批准飞书/微信侧收到的配对码）完成渠道 **登录**（扫码 / 凭证流）以及 **私聊配对批准**。

### channels login

```bash
xopc channels login
xopc channels login --channel weixin
xopc channels login --channel feishu
xopc channels login --channel feishu
xopc channels login --account <account-id>
```

各通道字段与控制台流程见 **[消息通道](./channels/index.md)**。

### channels pairing approve

当 Telegram、飞书或微信的 **`dmPolicy`** 为 **`pairing`** 时，未在允许列表中的用户会在私聊里收到 **一次性配对码**。管理员在主机上执行：

```bash
xopc channels pairing approve --channel telegram --account default AB12CD34
xopc channels pairing approve --channel feishu --account default AB12CD34
xopc channels pairing approve --channel feishu AB12CD34
xopc channels pairing approve --channel weixin AB12CD34
```

- **`--channel`**：必填，`telegram` \| `feishu` \| `weixin`。
- **`--account`**：配置中的账号 id（省略时一般为 `default`）。
- **`<code>`**：用户消息中的 8 位配对码。

成功后，该发送方 id 会写入对应通道的 **allowFrom 凭证文件**（与配置里的 `allowFrom` 在运行时合并）。文件路径说明见 **[消息通道 — DM 私聊配对](./channels/index.md#dm-pairing)**。

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

## tui

全屏终端里与智能体对话（流式输出、工具、思考块），基于 `@earendil-works/pi-tui`。

**快速开始：**

```bash
xopc tui                              # 网关模式（CLI 内置默认地址；可用 --url 覆盖）
xopc tui --local                      # 嵌入式 AgentService，无需网关
xopc tui --url http://localhost:18790 --token <令牌>
xopc tui -s <sessionKey> -m "你好"     # 指定会话 + 可选首条消息
```

| 参数 | 说明 |
|------|------|
| `--url <url>` | 网关根 URL |
| `--token <token>` | 网关 Bearer 令牌 |
| `-s, --session <key>` | 会话键（默认：`cli:tui`） |
| `-m, --message <text>` | 连接成功后自动发送一条 |
| `--local` | 嵌入式模式（不连网关） |
| `--thinking <level>` | 思考等级覆盖 |

斜杠命令、快捷键与两种模式说明见 **[终端界面（tui）](./tui.md)**。

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

## extensions

管理扩展。CLI/Web 安装目录为 `~/.xopc/extensions`，加载时仍按 workspace → global → bundled 的优先级发现扩展。

### 列出扩展

```bash
xopc extensions list
xopc extensions list --json
```

### 安装扩展

**从 npm 安装**：
```bash
xopc extensions install <package-name>

# 示例
xopc extensions install xopc-extension-telegram
xopc extensions install @scope/my-extension
xopc extensions install my-extension@1.0.0
```

**从本地目录安装**（安装到 `~/.xopc/extensions`）：
```bash
xopc extensions install ./my-local-extension
```

**仅从 xopc-store 安装**：
```bash
xopc extensions install --store telegram
```

**参数**：

| 参数 | 描述 |
|------|------|
| `--store` | 仅从 xopc-store 安装 |
| `--npm` | 仅从 npm 安装 |
| `-f, --force` | 替换已有的 store / 本地安装 |

**安装流程**：
1. 下载或复制扩展文件
2. 验证 `xopc.extension.json` 清单
3. 安装依赖（如有 `package.json` 依赖）
4. 安装到 `~/.xopc/extensions/<id>/`

**扩展发现优先级**（加载时）：
- 工作区 / agent 扩展目录（若存在旧数据或手动放置）
- Global (`~/.xopc/extensions/`)
- Bundled：内置扩展，优先级最低

### 健康检查、审计和校验

```bash
xopc extensions health
xopc extensions audit
xopc extensions verify [extension-id]
```

### 搜索、更新和锁定

```bash
xopc extensions search [keyword]
xopc extensions update [extension-id]
xopc extensions freeze
```

### 本地开发、打包和发布

```bash
xopc extensions dev ./my-local-extension
xopc extensions pack ./my-local-extension
xopc extensions publish ./my-local-extension --dry-run
```

**本地扩展结构**：
```
my-extension/
├── package.json          # npm 配置
├── index.ts              # 扩展入口（TypeScript）
├── xopc.extension.json   # 扩展清单
└── README.md             # 文档
```

**注意**：`extensions dev` 会将本地扩展软链到工作区，适合联调；`extensions pack` 可打包为 `.tgz` 用于分发。

---

## image

维护 **`agents.defaults.imageModel`**、**`imageGenerationModel`**、**`mediaMaxMb`** 及备用模型列表，无需手写长配置路径。

```bash
xopc image status
xopc image status --json
xopc image set-understanding openai/gpt-4o
xopc image set-generation openai/gpt-image-1
xopc image add-fallback understanding anthropic/claude-sonnet-4-5
xopc image add-fallback generation dashscope/wan2.6-t2i
xopc image remove-fallback understanding 0
xopc image providers
xopc image set-max-size 10
```

详见 [图像与视觉](image-multimodal.md)。

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
xopc extensions --help
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

## mcp

管理出站 MCP 服务器，或启动入站 stdio 桥接。

```bash
xopc mcp list
xopc mcp show fetch
xopc mcp set fetch '{"command":"npx","args":["-y","@modelcontextprotocol/server-fetch"]}'
xopc mcp unset fetch

# 入站 stdio 桥接 → 网关
xopc mcp serve --url http://127.0.0.1:18790 --token-file ~/.xopc/gateway.token
```

配置与控制台操作见 [MCP](./mcp.md)，CLI 参数与 REST 接口见 [MCP CLI 与 API](./cli/mcp.md)。

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
  extensions)
    shift
    xopc extensions "$@"
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
