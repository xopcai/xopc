<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">xopc</h1>

<p align="center">
  <strong>与你共同成长的 OPC 工作站。</strong><br />
  面向<strong>一人公司</strong>的轻量<strong>个人 AI 助手</strong> —— <strong>本地部署</strong>、<strong>密钥自备（BYOK）</strong>，用扩展就能加能力，不必 fork 核心代码。
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

**xopc** 是一套**自托管**的智能体方案：**命令行（CLI）**、全屏**终端界面（TUI）**、带 **React 管理台**的 **HTTP/WebSocket 网关**，以及可选的 **Electron** 桌面端（**macOS / Windows / Linux**），并内置 **Telegram、微信、飞书/Lark、钉钉** 等聊天机器人插件。大模型侧基于 **[@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono)**，对接 **20+** 家厂商。可通过**扩展**接入更多工具、频道和模型；配合 **SKILL.md** 管理技能；网关前台也能用 **`@xopcai/xopc/extension-ui-sdk`** 做界面扩展。

---

## 主要特性

| | |
| --- | --- |
| **数据留在身边** | 服务跑在你自己的机器上；只要不接外网机器人和联网工具，数据默认不出本机。也**不必**绑定某一家公有云才能用。 |
| **BYOK** | API Key、OAuth 等写在配置文件（`~/.xopc/xopc.json`）和环境变量里 —— 可用 DeepSeek(推荐)、 OpenAI、Anthropic、Google、**Ollama / LM Studio / vLLM**、Bedrock、Azure、OpenRouter、各类网关等。 |
| **多种用法** | **`xopc tui`**（全屏终端）、**`xopc agent`**（命令行里一问一答）、**浏览器里开网关控制台**、**Electron 桌面**（同一套界面）。 |
| **聊天机器人** | 内置 **Telegram**、**微信**、**飞书/Lark**、**钉钉**，外加网关自带的**网页对话**；支持私聊、群聊的访问控制（配对、白名单等）。 |
| **图片与语音** | **图片**：识图、按配置的生图。**语音**：语音转文字 / 文字转语音（如 Telegram、网关等场景），详见文档。 |
| **可扩展** | **服务端**：`ChannelPlugin`、工具、cron、自定义模型接入。**界面**：用 **`@xopcai/xopc/extension-ui-sdk`** 改网关控制台。 |

---

## 安装

**环境要求：** Node.js **≥ 22**（跑 CLI 和网关都要）。从本仓库开发时建议用 **pnpm**。

```bash
npm install -g @xopcai/xopc
# 或: pnpm add -g @xopcai/xopc
```

**装好以后：** 建议先跑一次交互式向导，把模型、密钥、频道等配齐。

```bash
xopc onboard
# 只想快速配模型: xopc onboard --quick
```

---

<a id="quick-start"></a>

## 快速上手

```bash
# 全屏终端 UI：智能体跑在本机，可以不单独起网关
xopc tui --local

# 命令行里多轮对话
xopc agent -i

# 只问一句
xopc agent -m "总结最近 5 条提交"

# 网关：REST/SSE + 内置网页控制台（具体地址看终端日志或 gateway 配置）
xopc gateway

# 同一网关，后台常驻（会打印 PID/地址；停止用 `xopc gateway stop`）
xopc gateway --background
```

**克隆源码参与开发：**

```bash
git clone https://github.com/xopcai/xopc.git && cd xopc
pnpm install && pnpm run dev -- agent -i   # 开发时不用先 pnpm run build
pnpm run build                              # 打正式包：Node + 网页 → dist/
```

**Electron 桌面版**（把网关和界面打成一个安装包）：本地执行 `pnpm run electron:build`，输出在 `dist/release/`（常见后缀：`.dmg`、`.exe`、`.AppImage`、`.deb`）。流水线会按平台出包；正式安装包见 [GitHub Releases](https://github.com/xopcai/xopc/releases)。

---

## 选哪种用法？

| 用法 | 命令 / 操作 | 适合谁 |
| --- | --- | --- |
| **TUI** | `xopc tui`、`xopc tui --local` 或 `xopc tui --url …` | 喜欢全屏终端、或要连远程网关 |
| **CLI** | `xopc agent -i` / `xopc agent -m "…"` | 写脚本、只要一个普通终端 |
| **网页** | 先 `xopc gateway`（前台）或 `xopc gateway --background`（后台），再用浏览器打开控制台地址 | 多人共用一台网关、习惯浏览器、要改设置 |
| **Electron** | 装 Release 里的安装包，或本地 `pnpm run electron:build` | 要原生窗口（macOS / Windows / Linux） |

---

## 内置频道（配置项）

在 **`~/.xopc/xopc.json`** 里配置 **`channels.*`**（路径可用环境变量 `XOPC_CONFIG` / `XOPC_CONFIG_PATH` 覆盖）。各 IM 机器人都要**先起网关**；微信需在**跑网关的那台电脑**上扫码登录。

| 频道 | 配置节 | 说明 |
| --- | --- | --- |
| **Telegram** | `channels.telegram` | 多账号、流式输出、语音、文件；私聊/群聊策略 |
| **微信（Weixin）** | `channels.weixin` | 在网关机器上扫码；私聊/群聊策略 |
| **飞书 / Lark** | `channels.feishu` | 机器人、Webhook 等，见文档 |
| **钉钉** | `channels.dingtalk` | Stream 模式；应用凭证见文档 |
| **网页** | *（随网关）* | React 管理台里的对话，不是第三方 IM |

字段说明与安全默认值：**[频道](https://xopcai.github.io/xopc/zh/channels)**、**[配置](https://xopcai.github.io/xopc/zh/configuration)**。

---

## 本地部署与 BYOK

- **密钥自己管：** 在配置里写 `providers.*`，再配合各厂商的环境变量（见 **[模型](https://xopcai.github.io/xopc/zh/models)**）。
- **完全离线推理：** 把默认模型指到 **Ollama**、**LM Studio**、**vLLM** 等兼容 OpenAI 接口的本地服务，可以不接公网大模型。
- **可选工具**（例如浏览器自动化）默认**关着**，要用再在配置里打开，并按需装 Playwright Chromium 等。

---

## CLI 与网关

| 想做什么 | 怎么做 |
| --- | --- |
| 在终端里聊 | `xopc tui --local` 或 `xopc agent -i` |
| 打开网页控制台 | `xopc gateway`，再按日志或配置里的地址访问 |
| 网关后台常驻 | `xopc gateway --background`；需要时查 `xopc gateway status`、停 `xopc gateway stop`、重启 `xopc gateway restart`、看日志 `xopc gateway logs` |
| 接 Telegram / 微信 / 飞书 / 钉钉 | 配好 `channels.*` 并运行网关；微信执行：`xopc channels login --channel weixin` |
| 重新跑一遍向导 | `xopc onboard` |
| 定时任务 | 在配置里打开 `cron` |

全部子命令见 **[CLI 参考](https://xopcai.github.io/xopc/zh/cli)**。

---

## 安全

从聊天软件进来的消息一律当成**不可信输入**。没摸清风险前，私聊建议用 **pairing（配对）** 或 **allowlist（白名单）**。网关监听地址、访问令牌（token）别泄露 —— 详见 **[频道](https://xopcai.github.io/xopc/zh/channels)**。

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
| [语音](https://xopcai.github.io/xopc/zh/voice) | 语音转文字 / 文字转语音 |
| [架构](https://xopcai.github.io/xopc/zh/architecture) | 整体结构 |

---

## 大模型厂商（概览）

**DeepSeek**（推荐）、OpenAI、Anthropic、Google、Groq、OpenRouter、Mistral、xAI、Bedrock、Azure、Vertex、Vercel AI Gateway、OAuth（如 Copilot/Codex）以及本地推理栈（经 pi-ai 统一接入）。详情：**[模型](https://xopcai.github.io/xopc/zh/models)**。

---

## 扩展与技能

```bash
xopc extension install xopc-extension-weather
xopc extension create my-extension --kind tool
xopc skills list
xopc skills install <名称>
```

服务端扩展可以带**工具**、**新频道**、**自定义模型**；网关**界面**扩展用 **`@xopcai/xopc/extension-ui-sdk`**（代码在 `packages/extension-ui-sdk/`）。详见 **[扩展](https://xopcai.github.io/xopc/zh/extensions)**、**[技能](https://xopcai.github.io/xopc/zh/skills)**。

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

需要微信、飞书、钉钉时，再加上 **`channels.weixin`**、**`channels.feishu`**、**`channels.dingtalk`** —— 完整字段见 **[配置](https://xopcai.github.io/xopc/zh/configuration)** 与 **[频道](https://xopcai.github.io/xopc/zh/channels)**。

---

## 代码目录结构

```
src/
├── agent/       # 智能体服务、工具、记忆、提示词
├── channels/    # 频道插件框架
├── cli/         # 命令行入口与各子命令
├── config/      # 配置 schema 与加载
├── cron/        # 定时任务
├── gateway/     # HTTP/WebSocket 服务
├── providers/   # 模型注册
├── session/     # 会话
├── tui/         # 终端 UI（pi-tui）
└── …
web/             # 网关控制台（React + Vite）
```

给贡献者的约定与说明：**[AGENTS.md](./AGENTS.md)**。

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

---

<p align="center"><sub>由 <a href="https://github.com/xopcai">xopcai</a> 维护</sub></p>
