<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">xopc</h1>

<p align="center">
  <strong>与你一起成长的 OPC 工作站。</strong><br />
  为一人公司打造的本地优先 AI 助手。CLI、桌面、浏览器、手机、即时通讯——全平台覆盖。<br />
  自带钥匙，无需 fork 即可扩展。
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
  <a href="https://xopc.ai">官网</a> ·
  <a href="https://github.com/xopcai/xopc">GitHub</a> ·
  <a href="https://xopcai.github.io/xopc/zh/">中文文档</a> ·
  <a href="https://xopcai.github.io/xopc/zh/models">模型</a> ·
  <a href="https://xopcai.github.io/xopc/zh/configuration">配置</a> ·
  <a href="https://xopcai.github.io/xopc/zh/cli">CLI</a>
</p>

**xopc** 是一套可**装在自己机器上**的智能体工具链：**命令行（CLI）**、全屏**终端界面（TUI）**、带网页后台的 **HTTP/SSE 网关**（REST JSON API，流式与实时更新走 **Server-Sent Events**；控制台用 **React** 编写），以及可选的 **Electron** 桌面版（**macOS / Windows / Linux**），并内置 **Telegram、微信、飞书/Lark** 等机器人插件。模型调用基于 **[@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono)**，可对接 **20+** 家厂商。通过**扩展**加工具、接新机器人、接新模型；用 **SKILL.md** 管理技能；网页端还能用 **`@xopcai/xopc/extension-ui-sdk`** 做界面扩展。

---

## 为什么选 xopc

| | |
| --- | --- |
| **你的机器，你的规则。** | xopc 运行在你自己的硬件上。对话留在本地，密钥存在你的配置里。没有强制云端，没有意外账单，没有数据在你不知情时外流。**`~/.xopc/`**——一切尽在你拥有的目录里。 |
| **自带钥匙，任选模型。** | DeepSeek（推荐）、OpenAI、Anthropic、Google、Ollama、LM Studio、vLLM、Bedrock、Azure——内置 20+ 供应商。纯离线本地推理也行，云端本地混搭也行。一行配置切换模型，零厂商绑定。 |
| **一个大脑，每块屏幕都能用** | 同一个助手——终端、浏览器、桌面应用、手机、即时通讯。无需同步，因为本来就是同一个系统。 |
| **跟你一起长大，永远不会过时。** | 一行命令安装技能，Extensions 增加工具/通道/UI 面板，多 Agent 路由不同场景。**`xopc skills install`** · **`xopc extensions install`**——装好就能用。 |
| **Cron 定时** | 摘要、提醒与报告按时间表推送。不只是被动回复，还能在你专注别处时主动运行。 |
| **多 Agent 路由** | 不同场景路由到不同 Agent——各自模型、工作区、工具与系统提示词，上下文完全隔离。工作、创作、编码各用一套。 |

---

## 30 秒，立即开始

安装 CLI、运行 onboard、在终端开聊——三步，半分钟上手：

```bash
npm install -g @xopcai/xopc
xopc onboard          # 想更快可先执行：xopc onboard --quick
xopc tui --local
```

**环境：** Node.js **≥ 22**。在本仓库里开发时建议用 **pnpm**。

**中国大陆用户**可在 `npm install` 时加上 `--registry=https://registry.npmmirror.com`，或执行 `npm config set registry https://registry.npmmirror.com` 设为默认。

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

## 演示

[![asciinema](https://asciinema.org/a/PlH1sYqOiV3malzu.svg)](https://asciinema.org/a/PlH1sYqOiV3malzu)

---

<a id="electron-desktop"></a>

## Electron 桌面版

### 从 GitHub Releases 下载

1. 打开 **[GitHub Releases](https://github.com/xopcai/xopc/releases)**。
2. 在最新版本里选本机系统对应的安装包（常见：**macOS** 用 `.dmg` / `.zip`，**Windows** 用 `.exe`，**Linux** 用 `.AppImage` / `.deb`）。
3. 像平时装软件一样安装或运行。macOS 若用语音相关功能，首次可能会要**麦克风**权限。

暂时没有适合你系统的安装包时，可先装命令行版，再用 **`xopc gateway`**；需要桌面安装包可自行 **[从源码打包](#electron-desktop)**。

### 从源码打包

```bash
pnpm install
pnpm run electron:build   # 输出在 dist/release/
```

---

## 怎么用？

| 方式 | 怎么用 | 适合谁 |
| --- | --- | --- |
| **TUI** | `xopc tui`、`xopc tui --local` 或 `xopc tui --url …` | 全键盘操作，流式输出，零延迟感 |
| **CLI** | `xopc agent -i` / `xopc agent -m "…"` | 写脚本、只要一个普通终端 |
| **网页** | 先 `xopc gateway`（前台）或 `xopc gateway --background`（后台），浏览器打开控制台地址 | 打开浏览器就是完整控制台 |
| **桌面** | **[Releases 下载安装包](#electron-desktop)** 或本地打包 | 原生桌面体验，三平台通吃 |
| **手机** | 扫码配对网关 | 通勤路上也能用 |
| **即时通讯** | Telegram、微信、飞书/Lark——配好 `channels.*` 并启动网关 | 在你最常用的 IM 里直接对话 |

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
xopc skills install <名称>     # 用 SKILL.md 教会助手新领域，不写代码
xopc extensions install <包名>  # 工具、通道、UI 面板
xopc extensions dev ./my-extension
xopc skills list
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

参与贡献请先读：**[AGENTS.md](./AGENTS.md)** · **[CONTRIBUTING.md](./CONTRIBUTING.md)**（Issue / PR 流程，英文）。

---

## 反馈问题

请使用 [Bug 模板](https://github.com/xopcai/xopc/issues/new?template=bug_report.yml) 或 [功能建议模板](https://github.com/xopcai/xopc/issues/new?template=feature_request.yml)。配置与使用问题请优先发 [Discussions → Q&A](https://github.com/xopcai/xopc/discussions/categories/q-a)。安全问题请走 [私有 advisory](https://github.com/xopcai/xopc/security/advisories/new)。详见 **[CONTRIBUTING.md](./CONTRIBUTING.md)**。

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
