# 快速开始

装好 **xopc**、配上至少一家大模型厂商的密钥后，就可以用 **命令行**、**全屏终端（TUI）**、**网关网页控制台** 或 **Electron 桌面版**。本页从「第一次安装」讲起。

## 30 秒，立即开始

安装 CLI、运行 onboard、在终端开聊——三步，半分钟上手：

```bash
npm install -g @xopcai/xopc
xopc onboard          # 想更快可先执行：xopc onboard --quick
xopc tui --local
```

**国内镜像：** `npm install -g @xopcai/xopc --registry=https://registry.npmmirror.com`

下文会展开网关、频道、桌面版与故障排除等细节。

## 终端演示

[![asciinema](https://asciinema.org/a/PlH1sYqOiV3malzu.svg)](https://asciinema.org/a/PlH1sYqOiV3malzu)

## 1. 环境要求

- **Node.js**：**22** 及以上（`node -v`）
- **pnpm**：仅在 [从源码构建](#方式二从源码构建) 本仓库时需要（`pnpm --version`）

日常使用可直接 **`npm install -g @xopcai/xopc`**（或 `pnpm add -g`），不必先装 pnpm。

## 2. 安装

### 方式一：从 npm 安装（推荐）

```bash
npm install -g @xopcai/xopc
```

### 方式二：从源码构建

```bash
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install
pnpm run build
```

## 3. 配置

### 交互式配置（推荐）

```bash
xopc onboard
# 本仓库开发时：pnpm run dev -- onboard
```

向导一般会带你完成：

1. 创建主 Markdown 工作区（默认常见路径如 `~/.xopc/workspace/main/`）
2. 生成默认 **`~/.xopc/xopc.json`**
3. 选择大模型厂商并填 API Key（**DeepSeek** 对多数场景很合适）
4. 按需配置 **Telegram、微信、飞书/Lark** 等机器人（可跳过）
5. 网关网页控制台，以及结束时可选 **TUI** 或 **网关** 用法提示

### 快速生成文件（无交互）

```bash
xopc setup
```

只生成基础配置与工作区骨架，不逐步提问。

### 手写配置

编辑 **`~/.xopc/xopc.json`**（也可用环境变量 **`XOPC_CONFIG`** / **`XOPC_CONFIG_PATH`** 指向别的路径）：

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5",
      "max_tokens": 8192,
      "temperature": 0.7
    }
  },
  "providers": {
    "anthropic": "${ANTHROPIC_API_KEY}"
  }
}
```

> **提示：** API Key 建议放在环境变量里（如 `ANTHROPIC_API_KEY`），配置里用 `${…}` 引用。

## 4. 第一次对话（命令行或 TUI）

### 只问一句（`agent`）

```bash
xopc agent -m "用一句话解释什么是 LLM。"
# 本仓库开发时：pnpm run dev -- agent -m "…"
```

### 普通终端里多轮聊（`agent -i`）

```bash
xopc agent -i
# 本仓库开发时：pnpm run dev -- agent -i
```

出现 `You:` 后输入内容回车发送，**Ctrl+C** 退出。

### 全屏终端（可不先起网关）

```bash
xopc tui --local
```

连已启动的网关、选会话等用法见 **[终端界面（TUI）](./tui.md)**。

## 5. 网关、后台运行与频道

### 以 Telegram 为例

1. **拿 Bot Token**：Telegram 里搜 [@BotFather](https://t.me/BotFather)，发 `/newbot` 按提示创建机器人。

2. 在 **`~/.xopc/xopc.json`** 里增加 **`channels.telegram`**：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_BOT_TOKEN",
      "dmPolicy": "allowlist",
      "allowFrom": [123456789]
    }
  }
}
```

3. **前台启动网关**（终端里会打印访问地址和 token）：

```bash
xopc gateway
# 本仓库开发时：pnpm run dev -- gateway
```

4. 去 **Telegram** 找机器人发消息，或在浏览器打开 **网页控制台**（端口以终端输出为准，常见默认 **18790**，具体看 `gateway.port`）。

### 网关放后台跑

```bash
xopc gateway service install
xopc gateway service start
```

之后可用 **`xopc gateway status`**、**`xopc gateway stop`**、**`xopc gateway restart`**、**`xopc gateway logs`**。详见 **[网关](./gateway.md)**。

### 其它内置频道

**微信、飞书/Lark** 同样在 **`channels.*`** 里配置，并需**先起网关**。总览与私聊策略见 **[频道](./channels/index.md)**。

## 6. Electron 桌面版（可选）

**macOS / Windows / Linux** 的安装包见 **[GitHub Releases](https://github.com/xopcai/xopc/releases)**（有发版时；Windows 为 `xopc-<版本>-x64.exe` 或 `xopc-<版本>-arm64.exe`）。与浏览器里打开的是同一套网关 + 网页控制台。

<video controls playsinline width="100%" style="max-width: 960px; border-radius: 8px;">
  <source src="https://xopc.ai/xopc-demo.mp4" type="video/mp4" />
</video>

在本仓库里自行打包：

```bash
pnpm install
pnpm run electron:build   # 产物在 dist/release/
```

## 7. 接下来看哪里

| 指南 | 说明 |
|------|------|
| [CLI 参考](/zh/cli) | 子命令与参数 |
| [配置](/zh/configuration) | `xopc.json` 全字段 |
| [扩展](/zh/extensions) | 插件与加载时机 |
| [技能](/zh/skills) | SKILL.md |
| [工具](/zh/tools) | 内置工具 |
| [频道](/zh/channels) | Telegram、微信、飞书、网页对话 |
| [TUI](/zh/tui) | 全屏终端 |
| [路由](/zh/routing-system) | 会话 key 与智能体绑定 |
| [模型](/zh/models) | 厂商与密钥 |

## 故障排除

### 常见问题

| 现象 | 处理 |
|------|------|
| `ERR_MODULE_NOT_FOUND` | 在本仓库根目录执行 `pnpm install` |
| `Cannot find module '@xopcai/...'` | 先 `pnpm run build` |
| 读不到配置 | 确认 **`~/.xopc/xopc.json`** 是合法 JSON |
| 机器人不回 | 查 Token、策略、`channels.*.enabled` |
| 模型报错 | 查对应厂商环境变量 / 控制台密钥 |

### 需要更多帮助

- 站点内其它中文页：[文档首页](/zh/)
- 开发约定：[AGENTS.md](https://github.com/xopcai/xopc/blob/main/AGENTS.md)
- 看网关日志：`xopc gateway logs --follow`
