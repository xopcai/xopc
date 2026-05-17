<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">xopc</h1>

<p align="center">
  <strong>与你共同成长的 OPC 工作站。</strong><br />
  面向<strong>一人公司</strong>的轻量<strong>个人 AI 助手</strong> —— <strong>本地部署</strong>、<strong>密钥自备（BYOK）</strong>，靠插件扩展能力，不必改核心代码。
</p>

<p align="center">
  <a href="https://github.com/xopcai/xopc"><img src="https://img.shields.io/badge/GitHub-xopcai%2Fxopc-181717?style=for-the-badge&amp;logo=github" alt="GitHub"></a>
  <a href="https://xopcai.github.io/xopc/zh/"><img src="https://img.shields.io/badge/Docs-中文文档-228B22?style=for-the-badge" alt="中文文档"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/快速开始-CLI-blue?style=for-the-badge" alt="快速开始"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node.js-%E2%89%A522-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-包管理器-F69220?logo=pnpm&amp;logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/大模型厂商-20%2B-5865F2" alt="大模型厂商">
  <a href="https://www.npmjs.com/package/@xopcai/xopc"><img src="https://img.shields.io/npm/v/@xopcai/xopc?label=npm&amp;color=teal" alt="npm version"></a>
</p>

<p align="center">
  <a href="https://github.com/xopcai/xopc">GitHub</a> ·
  <a href="https://xopcai.github.io/xopc/zh/">中文文档</a> ·
  <a href="https://xopcai.github.io/xopc/zh/models">模型</a> ·
  <a href="https://xopcai.github.io/xopc/zh/configuration">配置</a> ·
  <a href="https://xopcai.github.io/xopc/zh/cli">CLI</a>
</p>

**xopc** 是一套可**装在自己机器上**的智能体工具链：**命令行（CLI）**、全屏**终端界面（TUI）**、带网页后台的 **HTTP/SSE 网关**（REST JSON API，流式与实时更新走 **Server-Sent Events**；控制台用 **React** 编写），以及可选的 **Electron** 桌面版（**macOS / Windows / Linux**），并内置 **Telegram、微信、飞书/Lark** 等机器人插件。模型调用基于 **[@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono)**，可对接 **20+** 家厂商。通过**扩展**加工具、接新机器人、接新模型；用 **SKILL.md** 管理技能；网页端还能用 **`@xopcai/xopc/extension-ui-sdk`** 做界面扩展。

---

## 主要特性

| | |
| --- | --- |
| **数据留在身边** | 服务跑在你自己电脑上；不接入会主动访问外网的机器人或联网插件时，数据默认不出本机。也**不必**绑死某一家公有云。 |
| **BYOK** | API Key、OAuth 等写在配置文件（`~/.xopc/xopc.json`）和环境变量里 —— 可用 DeepSeek(推荐)、 OpenAI、Anthropic、Google、**Ollama / LM Studio / vLLM**、Bedrock、Azure、OpenRouter、各类网关等。 |
| **多种用法** | **`xopc tui`**（全屏终端）、**`xopc agent`**（命令行里多轮聊）、**浏览器开网关网页**、**Electron 桌面版**（同一套界面）。 |
| **聊天机器人** | 内置 **Telegram**、**微信**、**飞书/Lark**，以及网关自带的**网页对话**；私聊、群聊可做访问控制（配对、白名单等）。 |
| **图片与语音** | **图片**：识图、按需生图。**语音**：语音转文字、文字转语音（如 Telegram、网关等），详见文档。 |
| **可扩展** | **服务端**：`ChannelPlugin`、工具、定时任务（cron）、自定义模型接入。**界面**：用 **`@xopcai/xopc/extension-ui-sdk`** 扩展网关网页。 |

---

<a id="install"></a>

## 安装

**环境：** Node.js **≥ 22**（跑 CLI、起网关都需要）。在本仓库里开发时建议用 **pnpm**。

```bash
npm install -g @xopcai/xopc
# 或: pnpm add -g @xopcai/xopc
```

**中国大陆用户**可在 `npm install` 时加上 `--registry=https://registry.npmmirror.com`，例如：

```bash
npm install -g @xopcai/xopc --registry=https://registry.npmmirror.com
```

**装好后，**建议先跑一遍配置向导，把模型、密钥、机器人等一次配齐。

```bash
xopc onboard
# 只想快速选模型: xopc onboard --quick
```

---

<a id="quick-start"></a>

## 快速上手

```bash
# 全屏终端：对话在本地跑，不必先起网关
xopc tui --local

# 命令行里多轮对话
xopc agent -i

# 只问一句
xopc agent -m "总结最近 5 条提交"

# 网关：REST/SSE + 内置网页控制台（地址看终端输出或配置里的 gateway）
xopc gateway

# 同一套网关，后台常驻（会打印 PID 和地址；停服：xopc gateway stop）
xopc gateway --background
```

**从源码开发：**

```bash
git clone https://github.com/xopcai/xopc.git && cd xopc
pnpm install && pnpm run dev -- agent -i   # 开发阶段不必先 build
pnpm run build                              # 构建发布：Node + 网页 → dist/
```

---

## 终端演示

[![asciinema](https://asciinema.org/a/PlH1sYqOiV3malzu.svg)](https://asciinema.org/a/PlH1sYqOiV3malzu)

点击徽章播放 ([@micjoyce](https://asciinema.org/~micjoyce) · [asciinema.org](https://asciinema.org/a/PlH1sYqOiV3malzu))。本地回放：`asciinema play docs/asciinema/quick-start.cast`。

---

<a id="electron-desktop"></a>

## Electron 桌面版

### 从 GitHub Releases 下载

1. 打开 **[GitHub Releases](https://github.com/xopcai/xopc/releases)**。
2. 在最新版本里选本机系统对应的安装包（常见：**macOS** 用 `.dmg` / `.zip`，**Windows** 用 `.exe`，**Linux** 用 `.AppImage` / `.deb`）。
3. 像平时装软件一样安装或运行。macOS 若用语音相关功能，首次可能会要**麦克风**权限。

暂时没有适合你系统的安装包时，可先按上文 **[安装](#安装)** 装命令行版，再用 **`xopc gateway`**；需要桌面安装包可自行 **[从源码打包](#electron-desktop)**。

### 从源码打包

```bash
pnpm install
pnpm run electron:build   # 输出在 dist/release/
```

---

## 怎么用？

| 方式 | 怎么用 | 适合谁 |
| --- | --- | --- |
| **TUI** | `xopc tui`、`xopc tui --local` 或 `xopc tui --url …` | 喜欢全屏终端，或要连远程网关 |
| **CLI** | `xopc agent -i` / `xopc agent -m "…"` | 写脚本、只要一个普通终端 |
| **网页** | 先 `xopc gateway`（前台）或 `xopc gateway --background`（后台），浏览器打开控制台地址 | 多人共用一台网关、习惯浏览器、要改各项设置 |
| **Electron** | **[Releases 下载安装包](#electron-desktop)** 或本地打包 | 要系统原生窗口（macOS / Windows / Linux） |

---

## 内置频道（怎么配）

在 **`~/.xopc/xopc.json`** 里写 **`channels.*`**（配置文件路径可用环境变量 `XOPC_CONFIG` / `XOPC_CONFIG_PATH` 改掉）。各聊天机器人都要**先启动网关**；微信要在**跑网关的那台电脑**上扫码。

| 频道 | 对应配置 | 说明 |
| --- | --- | --- |
| **Telegram** | `channels.telegram` | 多账号、流式回复、语音、文件；私聊/群聊策略 |
| **微信** | `channels.weixin` | 在装网关的机器上扫码；私聊/群聊策略 |
| **飞书 / Lark** | `channels.feishu` | 机器人、Webhook 等，见文档 |
| **网页** | *（随网关）* | 网关网页里的对话，不是单独再装一个 IM |

字段说明与安全默认值：**[频道](https://xopcai.github.io/xopc/zh/channels)**、**[配置](https://xopcai.github.io/xopc/zh/configuration)**。

---

## 本地部署与 BYOK

- **密钥自己管：** 配置里写 `providers.*`，再配合各厂商环境变量（见 **[模型](https://xopcai.github.io/xopc/zh/models)**）。
- **纯本地推理：** 把默认模型指到 **Ollama**、**LM Studio**、**vLLM** 等兼容 OpenAI 接口的本地服务，可以不接公网大模型。
- **可选工具**（如浏览器自动化）默认**关闭**，要用再在配置里打开，并按需安装 Playwright Chromium 等。

---

## 常用操作速查

| 想做什么 | 怎么做 |
| --- | --- |
| 在终端里聊 | `xopc tui --local` 或 `xopc agent -i` |
| 打开网页控制台 | `xopc gateway`，按终端或配置里的地址打开 |
| 网关放后台跑 | `xopc gateway --background`；可查 `xopc gateway status`、停 `xopc gateway stop`、重启 `xopc gateway restart`、看日志 `xopc gateway logs` |
| 接 Telegram / 微信 / 飞书 | 配好 `channels.*` 并启动网关；微信：`xopc channels login --channel weixin` |
| 再跑一遍配置向导 | `xopc onboard` |
| 定时任务 | 在配置里启用 `cron` |

更多子命令见 **[CLI 参考](https://xopcai.github.io/xopc/zh/cli)**。

---

## 安全

从微信、Telegram 等渠道进来的消息都当作**不可信内容**。没摸清风险前，私聊建议用 **pairing（配对）** 或 **allowlist（白名单）**。网关监听地址、访问令牌（token）不要泄露 —— 详见 **[频道](https://xopcai.github.io/xopc/zh/channels)**。

---

## 文档

| 指南 | 说明 |
| --- | --- |
| [快速开始](https://xopcai.github.io/xopc/zh/getting-started) | 安装、向导、第一次对话 |
| [配置](https://xopcai.github.io/xopc/zh/configuration) | `xopc.json` 字段说明 |
| [CLI](https://xopcai.github.io/xopc/zh/cli) | 命令与参数 |
| [频道](https://xopcai.github.io/xopc/zh/channels) | 各内置频道 |
| [扩展](https://xopcai.github.io/xopc/zh/extensions) | 扩展机制 |
| [工具](https://xopcai.github.io/xopc/zh/tools) | 内置工具 |
| [技能](https://xopcai.github.io/xopc/zh/skills) | SKILL.md |
| [语音](https://xopcai.github.io/xopc/zh/voice) | 语音转文字、文字转语音 |
| [架构](https://xopcai.github.io/xopc/zh/architecture) | 整体结构 |

---

## 大模型厂商

**DeepSeek**（推荐）、OpenAI、Anthropic、Google、Groq、OpenRouter、Mistral、xAI、Bedrock、Azure、Vertex、Vercel AI Gateway、OAuth（如 Copilot/Codex）以及本地推理（由 pi-ai 统一接入）。详情：**[模型](https://xopcai.github.io/xopc/zh/models)**。

---

## 扩展与技能

```bash
xopc extensions install xopc-extension-weather
xopc extensions dev ./my-extension
xopc skills list
xopc skills install <名称>
```

扩展里可以带**工具**、**新聊天频道**、**自定义模型**；要改网关网页界面用 **`@xopcai/xopc/extension-ui-sdk`**（代码在 `packages/extension-ui-sdk/`）。详见 **[扩展](https://xopcai.github.io/xopc/zh/extensions)**、**[技能](https://xopcai.github.io/xopc/zh/skills)**。

---

## 配置示例

默认配置文件：**`~/.xopc/xopc.json`**。

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
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_TOKEN",
      "dmPolicy": "allowlist",
      "allowFrom": [123456789]
    }
  }
}
```

要用微信、飞书，再补上 **`channels.weixin`**、**`channels.feishu`** —— 完整字段见 **[配置](https://xopcai.github.io/xopc/zh/configuration)** 与 **[频道](https://xopcai.github.io/xopc/zh/channels)**。

---

## 代码目录结构

```
src/
├── agent/       # 智能体服务、工具、记忆、提示词
├── channels/    # 频道插件框架
├── cli/         # 命令行入口与各子命令
├── config/      # 配置 schema 与加载
├── cron/        # 定时任务
├── gateway/     # HTTP + SSE 网关服务
├── providers/   # 模型注册
├── session/     # 会话
├── tui/         # 终端 UI（pi-tui）
└── …
web/             # 网关控制台（React + Vite）
```

参与贡献请先读：**[AGENTS.md](./AGENTS.md)**。

---

## 开发

```bash
pnpm install
pnpm run dev          # 用 tsx 跑 CLI
pnpm run build        # 构建 Node + 网页 → dist
pnpm test
pnpm run lint
```

---

## 致谢

- 大模型接入层：[@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono)
- 智能体运行时：[@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
- 灵感来自 [openclaw/openclaw](https://github.com/openclaw/openclaw) 与 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>由 <a href="https://github.com/xopcai">xopcai</a> 维护</sub></p>
