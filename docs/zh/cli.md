# CLI 命令参考

xopc 提供丰富的 CLI 命令用于管理、对话和配置。

## 使用方式

### 从 npm 安装（推荐）

```bash
# 全局安装
npm install -g @xopcai/xopc

# 直接使用命令
xopc              # 打开本地 TUI
xopc <command>
```

### 从源码运行（开发）

```bash
# 克隆并安装
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install

# 使用 pnpm run dev -- 前缀
pnpm run dev --          # 打开本地 TUI
pnpm run dev -- <command>
pnpm run dev:init        # 初始化隔离开发状态到 ~/.xopc-dev
pnpm run dev:gateway     # 使用 ~/.xopc-dev 启动 gateway，日志级别为 info
```

`dev:init` / `dev:gateway` 会设置 `XOPC_STATE_DIR`、`XOPC_CONFIG(_PATH)`、`XOPC_LOG_DIR` 和 `XOPC_LOG_LEVEL=info`，避免源码开发时的 gateway 读写正式 `~/.xopc`。gateway 参数放在 `--` 后面，例如 `pnpm run dev:gateway -- --port 18791`。

**本文档中的命令示例默认使用 `xopc` 命令。** 如果你从源码运行，请将 `xopc` 替换为 `pnpm run dev --`。

---

## 命令列表

| 命令 | 描述 |
|------|------|
| `init` | 初始化 xopc 状态目录、配置和 agent 工作区 |
| `setup` | 初始化配置文件和工作区目录 |
| `profile` | 管理隔离状态 profile |
| `onboard` | 交互式设置向导（LLM、渠道、Gateway） |
| `channels` | 渠道目录/配置管理与私聊配对批准（`channels pairing approve`） |
| `auth` | 管理认证凭据 |
| `agent` | 与智能体对话 |
| `tui` | 全屏终端对话界面（默认嵌入式，可选网关模式）— 详见 [TUI](./tui.md) |
| `tunnel` | 管理 FRP 远程访问隧道 |
| `gateway` | 启动 REST 网关 |
| `session` | 管理会话 |
| `doctor` | 检查安装健康状态并诊断常见问题 |
| `update` | 检查并安装 xopc 更新（含扩展同步与 gateway 重启）— 见 [更新](./update.md) |
| `logs` | 管理和查询日志 |
| `goal` | 管理长期目标 |
| `project` | 管理长期项目 |
| `config` | 查看和编辑配置（非交互式） |
| `image` | 查看图像运行时行为和可用 provider |
| `models` | 列出和管理模型及模型认证 |
| `providers` | 管理 LLM provider 凭据 |
| `voice` | 配置 TTS 输出 |
| `search` | 管理 web search provider |
| `skills` | 管理技能（安装、启用、配置、测试） |
| `tailscale` | 查看网关远程访问的 Tailscale 状态 |
| `browser` | 浏览器自动化命令 |
| `agents` | 管理 `config.json` 中的多个智能体（`agents.list`：列出、添加、删除） |
| `extensions` | 管理扩展 |

MCP 配置见 [MCP](./mcp.md)。当前 `xopc --help` 不展示 `mcp` 作为顶层命令；请以网关设置和 MCP 配置文档为准。

### 子命令索引

具体选项以 `xopc <command> --help` 为准。下表对应当前 `xopc --help` 暴露的命令集合。

| 命令 | 支持的子命令 |
|------|--------------|
| `init` | 无子命令 |
| `setup` | 无子命令 |
| `profile` | `list`、`create`、`delete`、`switch` |
| `onboard` | 无子命令 |
| `channels` | `list`、`show`、`enable`、`disable`、`config`、`pairing` |
| `auth` | `list`、`set`、`get`、`remove`、`login`、`logout`、`profiles`、`clear`、`providers` |
| `agent` | 无子命令 |
| `tui` | 无子命令 |
| `tunnel` | `prefetch`、`consent`、`secret`、`start`、`stop`、`status`、`qr`、`broker` |
| `gateway` | `token`、`status`、`health`、`call`、`probe`、`stop`、`restart`、`logs`、`service`、`ssh-tunnel` |
| `session` | `list`、`info`、`delete`、`delete-many`、`rename`、`tag`、`untag`、`archive`、`unarchive`、`pin`、`unpin`、`search`、`grep`、`export`、`stats`、`cleanup` |
| `doctor` | 无子命令 |
| `update` | 无子命令 |
| `logs` | `list`、`query`、`stats`、`tail`、`clean`、`rotate` |
| `goal` | `list`、`new`、`show`、`pause`、`resume`、`archive`、`runs`、`checklist`、`evidence` |
| `project` | `list`、`new`、`show`、`update`、`archive`、`attach-session`、`detach-session`、`attach-goal`、`detach-goal`、`sessions`、`goals` |
| `config` | `get`、`set`、`unset`、`show`、`validate`、`token`、`path` |
| `image` | `status`、`providers` |
| `models` | `list`、`status`、`set`、`auth`（`list`、`login`、`paste-api-key`、`logout`） |
| `providers` | `list`、`set-key`、`unset-key`、`schema` |
| `voice` | `status`、`enable`、`disable`、`schema` |
| `search` | `list`、`add`、`remove`、`schema` |
| `skills` | `list`、`install`、`enable`、`disable`、`status`、`audit`、`config`、`hub`、`test` |
| `tailscale` | `status` |
| `browser` | `open`、`state`、`click`、`type`、`screenshot`、`validate`、`run`、`doctor`、`close`、`cloakbrowser`、`extension` |
| `agents` | `list`、`add`、`delete` |
| `extensions` | `list`、`inspect`、`freeze`、`health`、`verify`、`doctor`、`audit`、`pack`、`create`、`dev`、`install`、`search`、`publish`、`update` |

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
- 创建工作区目录并在 `agents/<id>/profile/` 生成 profile Markdown（SOUL.md、IDENTITY.md 等）

完整状态目录（agents、logs 等）请使用 **`xopc init`**。

---

## init

初始化完整 xopc 状态树（配置、`agents/<id>/`、logs、profile Markdown 种子）。

```bash
xopc init
xopc init --agent-id coder
xopc init --force
```

| 选项 | 描述 |
|------|------|
| `--force` | 强制重新初始化 |
| `--skip-workspace` | 跳过 profile Markdown 种子文件 |
| `--agent-id <id>` | 要初始化的智能体 id（默认 `main`） |

---

## profile

管理独立状态 Profile（`default` → `~/.xopc`，其它 → `~/.xopc-<name>`）。切换时在 shell 中设置 `XOPC_PROFILE`。

```bash
xopc profile list
xopc profile create staging
xopc profile switch staging
xopc profile delete staging --force
```

---

## onboard

xopc 的交互式设置向导。首次路径聚焦模型凭据和默认对话模型；网页控制台会在进入对话前可选引导填写个人资料。Gateway 绑定/端口/令牌沿用配置默认值（`127.0.0.1:18790`，token 缺失时自动生成），向导中不再逐项询问。

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
# 首次引导设置（默认）
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
- 默认 agent 创建和选择保持为内部实现，用户开聊前不需要处理 agent 配置
- 频道、技能和额外 agent 留到后续设置中再配置
- 应用 Gateway 默认设置（令牌缺失则自动生成）
- 交互结束前可选择：**终端 UI（本地嵌入）**、**Gateway（OS 系统服务）**，或稍后手动启动

---

## channels

在运行 CLI 的机器上管理消息渠道目录、配置块和 **私聊配对批准**。扫码或凭证流以具体渠道文档和网关控制台为准。

### 渠道目录与配置

```bash
xopc channels list
xopc channels show telegram
xopc channels enable telegram
xopc channels disable telegram
xopc channels config set-json telegram '{"enabled":true}'
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
| `agents add <name>` | **必须**提供 `--workspace <dir>`。将 `<name>` 用作 id/name 种子，写入/更新 `agents.list`，创建目录并种子化包含 `profile/IDENTITY.md` 在内的 Markdown 引导文件。可选：`--model`、`--agent-dir`。 |
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
xopc                                  # 等同于 xopc tui；嵌入式模式
xopc tui                              # 嵌入式 AgentService，无需网关
xopc tui --gateway                    # 强制网关模式
xopc tui --url http://localhost:18790 --token <令牌>
xopc tui --agent coder                # 用 coder 开启新的 TUI 会话
xopc tui --set-default-agent coder    # 持久化 TUI 默认 agent
xopc tui -s <sessionKey> -m "你好"     # 指定会话 + 可选首条消息
```

| 参数 | 说明 |
|------|------|
| `--url <url>` | 网关根 URL |
| `--token <token>` | 网关 Bearer 令牌 |
| `--gateway` | 强制网关模式 |
| `-s, --session <key>` | 要恢复的会话键；省略时新建 `agent:{currentAgent}:tui-<uuid>` 会话 |
| `--agent <id>` | 为本次新 TUI 会话指定 agent；仅覆盖本次启动的 `tui.defaultAgent` |
| `--set-default-agent <id>` | 持久化 `tui.defaultAgent` 后退出 |
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
| `--bind <mode>` | 绑定模式：`loopback`、`lan`、`auto`、`custom`、`tailnet`（默认取自配置） |
| `--token` | 认证令牌 |
| `--no-hot-reload` | 禁用配置热重载 |
| `--force` | 强制终止端口上的现有进程 |

后台常驻请使用 **`xopc gateway service install`**（见 [Gateway](./gateway.md)）。

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
| `gateway service` | 安装/启动/停止 OS 服务（`install`、`start`、`stop`、`restart`、`uninstall`） |

**示例**：

```bash
# 查看状态
xopc gateway status

# 停止网关
xopc gateway stop

# 重启网关
xopc gateway restart

# 查看最近 50 行日志
xopc gateway logs

# 实时跟踪日志
xopc gateway logs --follow

# 生成新令牌
xopc gateway token --generate

# 安装并启动系统服务
xopc gateway service install
xopc gateway service start
```

### 进程管理

- **锁文件**：`~/.xopc/locks/gateway.{hash}.lock`（替代 PID 文件）
- **信号**：SIGTERM/SIGINT=停止，SIGUSR1=重启
- **端口管理**：自动冲突检测和解决

**环境变量**：

| 变量 | 描述 |
|------|------|
| `XOPC_NO_RESPAWN` | 禁用进程重生 |
| `XOPC_SERVICE_MARKER` | 标记受监督环境 |

在 `xopc.json` 中设置 **`commands.restart: false`** 可禁用 SIGUSR1 重启。

---

## automations

自动化通过网关控制台 `#/automations` 或 REST API `/api/automations`、`/api/automation-runs` 管理。当前没有顶层 `xopc automations` 命令。

触发器、动作、可靠性与 API 详见 [自动化](./automations.md)。

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

`extensions update` 仅刷新 lockfile 中的扩展。`xopc update` 成功后会自动执行相同同步 — 见 [更新后扩展同步](./extensions.md#更新后扩展同步)。

---

## update（更新）

检查并安装 xopc 核心包更新；成功后同步 lockfile 扩展并重启 gateway（可禁用）。完整说明：[更新](./update.md)。

```bash
xopc update
xopc update --check
xopc update --channel beta
xopc update --yes --json
xopc update --no-restart
```

| 选项 | 说明 |
|------|------|
| `--check` | 仅查询 registry，不安装 |
| `--yes` | 跳过确认 |
| `--channel <stable\|beta\|dev>` | 覆盖配置中的 `update.channel` |
| `--json` | JSON 输出（含 `postUpdate`） |
| `--no-restart` | 安装成功后不重启 gateway |

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

查看当前图像运行时行为和可用的图像生成 provider。

```bash
xopc image status
xopc image status --json
xopc image providers
xopc image providers --json
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

当前 `xopc --help` 不暴露 `mcp` 作为顶层命令。请通过 `xopc.json` 中的 `mcp.servers` 和可用的网关控制台管理出站 MCP 服务器。

配置与控制台操作见 [MCP](./mcp.md)。[MCP CLI 与 API](./cli/mcp.md) 保留历史命令，供仍暴露这些子命令的安装或开发分支参考。

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
  extensions)
    shift
    xopc extensions "$@"
    ;;
  skills)
    shift
    xopc skills "$@"
    ;;
  *)
    echo "Usage: bot {chat|shell|start|extension|skills}"
    ;;
esac
```

使用：

```bash
bot chat Hello!
bot start
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
