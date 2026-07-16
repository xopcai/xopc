<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center"><a href="https://xopc.ai">xopc</a></h1>

<p align="center">
  <strong>把目标变成循环。</strong><br />
  让重要的事持续向前。<br />
  xopc 是自托管、本地优先的个人 AI 运行时：统一连接模型、Agent、持续状态、工作流、自动化与多端入口。你掌控数据、密钥和运行环境。
</p>

<p align="center">
  <a href="https://xopc.ai"><img src="https://img.shields.io/badge/官网-xopc.ai-0ea5e9?style=flat-square" alt="xopc.ai"></a>
  <a href="https://www.npmjs.com/package/@xopcai/xopc"><img src="https://img.shields.io/npm/v/@xopcai/xopc?label=npm&amp;color=teal" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node.js-%E2%89%A522-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
  <img src="https://img.shields.io/badge/大模型厂商-20%2B-5865F2" alt="大模型厂商">
  <a href="https://github.com/xopcai/xopc/stargazers"><img src="https://img.shields.io/github/stars/xopcai/xopc?style=flat-square&amp;color=gold" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="https://xopc.ai"><strong>xopc.ai</strong></a> ·
  <a href="https://github.com/xopcai/xopc"><strong>GitHub</strong></a> ·
  <a href="https://xopcai.github.io/xopc/zh/">中文文档</a> ·
  <a href="#get-started">快速开始</a> ·
  <a href="https://github.com/xopcai/xopc/releases">Releases</a>
</p>

<p align="center">
  <img src="docs/public/xopc-tui.gif" alt="xopc 终端界面演示" width="720">
</p>

<details>
<summary><strong>目录</strong></summary>

- [xopc 是什么](#xopc-是什么)
- [一套运行时，四类能力](#一套运行时四类能力)
- [快速开始](#快速开始)
- [为什么选 xopc](#为什么选-xopc)
- [和 Codex / Claude Code / QoderWork / WorkBuddy 的区别](#和-codex--claude-code--qoderwork--workbuddy-的区别)
- [在哪里聊](#在哪里聊)
- [内置频道](#内置频道)
- [扩展与技能](#扩展与技能)
- [配置示例](#配置示例)
- [文档](#文档)
- [常见问题](#常见问题)
- [桌面版](#desktop-app)
- [参与贡献](#参与贡献)

</details>

---

## xopc 是什么

xopc 不是某个模型的套壳，也不只是另一个聊天界面。它是一套**自托管、本地优先的个人 AI 运行时**：负责让模型、Agent、数据和触发器在同一个环境里协作。

你可以先把它当作一个使用自有密钥的本地助手；也可以进一步把真实项目交给它，用明确的目标和下一步保存状态，用笔记收集输入，用工作流拆解复杂任务，再用定时或 webhook 自动化触发后续工作。所有入口连接的是同一套运行时，而不是几个互相失忆的机器人。

## 一套运行时，四类能力

| 层次 | xopc 提供什么 | 解决什么问题 |
| --- | --- | --- |
| **运行与所有权** | 自托管 gateway、本地状态目录、自有 API Key、云端/本地模型 | 数据、成本与可用性由你掌控 |
| **持续状态** | 持久会话、项目、目标、笔记、工作区与 Agent 记忆策略 | 工作可以恢复，不必每次从零解释 |
| **执行与主动性** | 工具、技能、子 Agent、可观测工作流、定时/手动/webhook 自动化 | 从“给建议”走向“执行、检查并继续” |
| **随处接入** | CLI、TUI、网页、桌面、iOS/Android、Telegram、微信、飞书/Lark、HTTP/SSE API | 在工作发生的地方使用同一个系统 |

典型用法不是固定漏斗，而是按需组合：在终端处理代码，在手机上语音速记到 Notes，在项目页查看目标、阻塞与失败的工作流，在每天的自动化中生成摘要，最后从任意入口继续同一个会话。

了解这些部件如何形成可恢复、可触发、可检查的闭环：[持续工作模型](https://xopcai.github.io/xopc/zh/concepts/loops)。

---

<a id="get-started"></a>
<a id="quick-start"></a>

## 快速开始

### 最省心的开始方式：PC 桌面端

对大多数用户来说，**PC 桌面端**是最容易上手的方式：安装应用，在界面里完成模型设置，然后直接在内置控制台聊天。它会自动启动本地 gateway。

1. 从 **[GitHub Releases](https://github.com/xopcai/xopc/releases)** 下载 — macOS `.dmg`，Windows `.exe`，Linux `.AppImage` / `.deb`。
2. 打开 xopc，完成模型设置。
3. 开始聊天。

详见 **[PC 桌面端](https://xopcai.github.io/xopc/zh/desktop-app)**：安装说明、源码打包命令，以及后续截图/GIF/视频素材的预留文件位置。

### 一键安装（30 秒启动 — 推荐）

**Linux、macOS、WSL2、Termux**

```bash
curl -fsSL https://xopc.ai/install.sh | bash
```

**Windows（原生 PowerShell）**

> **提示：** 原生 Windows 无需 WSL 即可运行 xopc——CLI、网关、TUI 与工具均可在本机使用。若更习惯 WSL2，在 WSL 里执行上面的 bash 命令即可。

```powershell
iex (irm https://xopc.ai/install.ps1)
```

安装脚本会自动识别系统、在需要时安装 **Node.js ≥ 22**，并安装 **`@xopcai/xopc`**。国内镜像：bash 加 `--cn`，PowerShell 加 `-Cn`，或指定 `--registry https://registry.npmmirror.com`。

然后直接开聊：

```bash
xopc onboard --quick
xopc                    # 打开本地 TUI
```

### npm（已具备 Node.js 22+）

```bash
npm install -g @xopcai/xopc
```

也可用 pnpm：`pnpm add -g @xopcai/xopc` · 国内：`npm install -g @xopcai/xopc --registry=https://registry.npmmirror.com`

### 更多命令

```bash
xopc agent -i                    # 交互式 CLI
xopc agent -m "总结最近 5 条提交"  # 只问一句
xopc gateway                     # 网页服务 + React 控制台
xopc gateway service install     # OS 系统服务
```

**从源码**（安装脚本或 pnpm workspace）：

```bash
# 安装脚本 — 克隆、构建，并写入 ~/.local/bin/xopc 包装命令
curl -fsSL https://xopc.ai/install.sh | bash -s -- --install-method git

# 或手动克隆
git clone https://github.com/xopcai/xopc.git && cd xopc
corepack enable && pnpm install && pnpm run build
pnpm exec xopc onboard
```

Windows 源码安装：`& ([scriptblock]::Create((irm https://xopc.ai/install.ps1))) -InstallMethod git`

**环境：** Node.js **≥ 22**（一键脚本会自动处理）。从源码开发本仓库时请使用 **pnpm**。更多安装方式见 **[xopc.ai](https://xopc.ai)** 与 **[快速开始](https://xopcai.github.io/xopc/zh/getting-started)**。

---

## 为什么选 xopc

- 🧠 **有状态，不只是一轮上下文** — 会话、项目、目标、笔记、工作区和运行记录都有明确归属，长期工作可以恢复。
- 🏠 **运行在你的环境里** — 配置与本地状态默认在 **`~/.xopc/`**；你决定如何部署、备份和远程访问。
- 🔑 **使用自己的密钥** — OpenAI、Anthropic、Google、DeepSeek、Ollama、LM Studio、vLLM 等 **20+** 厂商；云端和本地模型可混用。
- ⚙️ **能执行，也能主动触发** — 工具和工作流负责执行；自动化用定时、手动或 webhook 触发 Agent 与工作流。
- 🧭 **代码图谱增强编码** — `coder` agent 使用托管的本地代码库索引完成符号搜索、源码确认、调用追踪、变更影响与架构分析；图覆盖不足时回退到直接读取源码。
- 📡 **同一个运行时，多种入口** — 桌面、终端、网页、手机与 IM 共享 Agent、会话和项目状态。
- 🧩 **能力边界可配置** — 每个 Agent 可以拥有独立的身份、模型角色、工作区、工具策略、技能、记忆与边界，并通过扩展继续增加能力。

## 和 Codex / Claude Code / QoderWork / WorkBuddy 的区别

xopc 不是又一个聊天 UI。它更像一个本地优先的系统层：让同一个助手记住长期目标、保留状态、运行自动化，并在多个入口中持续可用。

| 产品 | 更擅长 | 为什么还需要 xopc |
| --- | --- | --- |
| **Codex** | 终端、IDE 和云端的软件开发任务 | xopc 不只服务一个代码仓库：长期目标、BYOK/本地模型、定时循环、Gateway API、桌面/网页/手机和 IM 都共享同一套本地状态。 |
| **Claude Code** | 项目级编码：读代码、改文件、跑测试、处理 git 工作流 | xopc 是面向个人长期工作的 AI 运行时：既能服务 coding，也能协调模型、频道、技能、工作流和自动化。 |
| **Qoder / QoderWork** | Agentic coding 平台与本地优先办公助手 | xopc 开源、可自托管、可改造，状态明确放在 **`~/.xopc/`**，支持自选 provider、自托管 gateway 和扩展机制。 |
| **WorkBuddy** | 办公交付物：报告、PPT、表格、调研、数据分析 | xopc 更适合想掌控运行环境的人：使用自己的 key，混用本地/云端模型，接入 IM，并把长期项目上下文留在本地。 |

如果你想要的是一个**自托管、长期运行、不绑定单一厂商/IDE/聊天入口/任务类型**的 AI 助手，xopc 更适合。完整对比见 **[产品对比](https://xopcai.github.io/xopc/zh/comparison)**。

---

## 在哪里聊

| 方式 | 怎么用 | 适合 |
| --- | --- | --- |
| **PC 桌面端** | [GitHub Releases](#desktop-app) | 最省心的开始方式：原生应用 + 内嵌 gateway 控制台 |
| **TUI** | `xopc` 或 `xopc tui`（远程：`xopc tui --url …`） | 全键盘、流式输出，最快终端路径 |
| **CLI** | `xopc agent -i` / `xopc agent -m "…"` | 脚本、最小终端环境 |
| **网页** | `xopc gateway` → 打开控制台地址 | 聊天、设置、日志 |
| **手机** | [移动端 App](./apps/mobile-expo) + 网关扫码配对（[移动端 App](https://xopcai.github.io/xopc/zh/mobile-app)、[远程访问](https://xopcai.github.io/xopc/zh/remote-access)） | 在 iOS/Android 上继续对话，记录文字、语音、图片和附件；Agent 仍运行在你的电脑或本地环境里 |
| **即时通讯** | 配置 `channels.*` 并启动网关 | Telegram、微信、飞书/Lark |

---

## 内置频道

在 **`~/.xopc/xopc.json`** 里配置 **`channels.*`**。即时通讯需要网关常驻；微信需要在**运行网关的机器**上扫码登录。

| 频道 | 配置项 | 说明 |
| --- | --- | --- |
| **Telegram** | `channels.telegram` | 多账号、流式、访问策略 |
| **微信** | `channels.weixin` | 网关主机扫码 |
| **飞书 / Lark** | `channels.feishu` | 机器人 / Webhook，见文档 |

完整说明：**[频道](https://xopcai.github.io/xopc/zh/channels)** · **[配置](https://xopcai.github.io/xopc/zh/configuration)**。

---

## 扩展与技能

```bash
xopc skills install <名称>       # SKILL.md 领域技能
xopc extensions install <包名>    # 工具、频道、UI 面板
xopc extensions dev ./my-extension
```

详见 **[扩展](https://xopcai.github.io/xopc/zh/extensions)** · **[技能](https://xopcai.github.io/xopc/zh/skills)**。网关 UI 扩展：**`@xopcai/xopc/extension-ui-sdk`**（`packages/extension-ui-sdk/`）。

---

## 配置示例

默认路径：**`~/.xopc/xopc.json`**。一个最小骨架：

```json
{
  "providers": { "deepseek": "${DEEPSEEK_API_KEY}" },
  "agents": { "default": "main", "list": [{ "id": "main", "models": { "roles": { "deep": { "model": "deepseek/deepseek-v4-flash" } } } }] }
}
```

完整参考：**[配置](https://xopcai.github.io/xopc/zh/configuration)**。需要即时通讯时再补 **`channels.*`**，可选工具（如浏览器）默认关闭。

---

## 文档

| 指南 | 说明 |
| --- | --- |
| [快速开始](https://xopcai.github.io/xopc/zh/getting-started) | 安装、向导、第一次对话 |
| [持续工作模型](https://xopcai.github.io/xopc/zh/concepts/loops) | 状态、执行与触发如何组成可恢复、可检查的工作闭环 |
| [项目、目标与笔记](https://xopcai.github.io/xopc/zh/projects-goals-notes) | 用明确的数据对象组织长期工作，而不是依赖超长聊天记录 |
| [配置](https://xopcai.github.io/xopc/zh/configuration) | `xopc.json` 字段 |
| [CLI](https://xopcai.github.io/xopc/zh/cli) | 命令与参数 |
| [频道](https://xopcai.github.io/xopc/zh/channels) | Telegram、微信、飞书 |
| [架构](https://xopcai.github.io/xopc/zh/architecture) | 整体结构 |
| [代码智能](https://xopcai.github.io/xopc/zh/code-intelligence) | `coder` agent 的托管本地代码知识图 |
| [工作流](https://xopcai.github.io/xopc/zh/workflows) | 扇出子 Agent、看板、脚本 |

更多：[工具](https://xopcai.github.io/xopc/zh/tools) · [移动端 App](https://xopcai.github.io/xopc/zh/mobile-app) · [语音](https://xopcai.github.io/xopc/zh/voice) · [远程访问](https://xopcai.github.io/xopc/zh/remote-access)

---

## 常见问题

**xopc 是云服务吗？** — 不是。一切跑在你的机器上，默认在 **`~/.xopc/`**。

**必须使用付费云端模型吗？** — 不必须。自带 API Key 或用本地模型（Ollama、LM Studio、vLLM）。

**最快怎么试用？** — [桌面端](#快速开始) 适合 GUI 用户，终端用户执行 `xopc onboard --quick && xopc`。

**它和普通聊天 UI 有什么区别？** — 聊天只是入口。xopc 还管理 Agent、持久会话、项目/目标、笔记、工作区、工作流、自动化和多端连接。

**能在手机或即时通讯里用吗？** — 可以。用 [移动端 App](./apps/mobile-expo) 扫码连接，或配置 Telegram、微信、飞书/Lark。

**还有问题？** — 去 [GitHub Discussions](https://github.com/xopcai/xopc/discussions/categories/q-a) 提问。

<a id="desktop-app"></a>

---

## 安全

来自即时通讯的消息视为**不可信输入**。私聊建议 **pairing（配对）** 或 **allowlist（白名单）**。请勿泄露网关监听地址与 token。详见 **[频道](https://xopcai.github.io/xopc/zh/channels)**。

---

## 参与贡献

```bash
pnpm install && pnpm run dev
pnpm run dev:gateway            # 开发 gateway 使用 ~/.xopc-dev + info 日志
pnpm run build && pnpm test && pnpm run lint
```

**[AGENTS.md](./AGENTS.md)** · **[CONTRIBUTING.md](./CONTRIBUTING.md)**（英文）

**反馈：** [Bug 反馈](https://github.com/xopcai/xopc/issues/new?template=bug_report.yml) · [功能建议](https://github.com/xopcai/xopc/issues/new?template=feature_request.yml) · [Q&A 讨论](https://github.com/xopcai/xopc/discussions/categories/q-a) · [安全漏洞反馈](https://github.com/xopcai/xopc/security/advisories/new)（请勿公开发布漏洞细节）

**技术栈：** TypeScript、Node.js ≥ 22、pnpm workspace。内置 LLM 层 `@earendil-works/pi-ai`，React 网关控制台，Electron 桌面端。

## 致谢

- 大模型接入：[@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono) · 运行时：[@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
- 代码智能：[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)，作为托管的本地知识图集成，用于理解代码库
- 用户理解：受 [OpenWiki](https://github.com/langchain-ai/openwiki) 从证据沉淀知识的思想启发，在 XOPC 中重新实现为带治理合成和逐轮上下文规划的原生能力，详见[用户理解](./docs/user-understanding.md)
- 灵感来自 [openclaw/openclaw](https://github.com/openclaw/openclaw) 与 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>由 <a href="https://github.com/xopcai">xopcai</a> 维护 · <a href="https://xopc.ai">xopc.ai</a></sub></p>
