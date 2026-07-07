<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center"><a href="https://xopc.ai">xopc</a></h1>

<p align="center">
  <strong>把目标变成循环。</strong><br />
  让真正重要的事情持续向前。<br />
  从一次普通对话开始，把项目持续托管给 xopc；在手机上随手记录 note/idea，再用自动化养成私有的本地 AI 数据飞轮。
</p>

<p align="center">
  <a href="https://xopc.ai"><img src="https://img.shields.io/badge/官网-xopc.ai-0ea5e9?style=flat-square" alt="xopc.ai"></a>
  <a href="https://www.npmjs.com/package/@xopcai/xopc"><img src="https://img.shields.io/npm/v/@xopcai/xopc?label=npm&amp;color=teal" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node.js-%E2%89%A522-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
  <img src="https://img.shields.io/badge/大模型厂商-20%2B-5865F2" alt="大模型厂商">
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

---

## 适合谁

- **想先简单用起来的人** —— 先本地开聊；项目变复杂后，再逐步加笔记、通道、连接器和自动化。
- **长期项目** —— 让目标、决策、阻塞点、下一步、反馈和校准始终连在一起，不会断在一次次聊天里。
- **随时可用的私有 Agent** —— xopc 跑在你的电脑上，手机 App 扫码连接；出门在外也能继续对话和记录想法，数据仍然留在你自己的 xopc 环境里。
- **独立开发者 / 一人公司** —— 同一个助手覆盖 CLI、TUI、网页、桌面、手机、Telegram、微信和飞书/Lark。
- **本地优先 AI 工作流** —— 使用你自己的 API Key，云端/本地模型混用，支持技能和扩展，数据默认保存在 **`~/.xopc/`**。

## 从聊天到数据飞轮

你不需要第一天就搭好复杂系统。xopc 的价值会随着你的使用逐步长出来。

| 阶段 | 你做什么 | xopc 开始帮你什么 |
| --- | --- | --- |
| **聊天** | 问问题、讨论想法、做判断。 | 先有一个使用你自己模型配置、状态保存在本地的 AI 助手。 |
| **项目** | 让它持续跟进一个真实目标。 | 记住目标、当前状态、阻塞点和下一步。 |
| **笔记 / 想法** | 随手丢进展、反馈、链接、灵感和复盘。 | 把零散输入沉淀成之后能继续使用的上下文。 |
| **外部入口** | 手机 App 扫码连接，也可以在桌面、终端、网页、IM 和 gateway API 里继续使用同一个助手。 | 不在电脑前也能对话、记录 note/idea；Agent 和数据仍在你的 xopc 环境里。 |
| **自动化** | 设置定时复盘、提醒、摘要和工作流运行。 | 重要事项会自己回到视野里，不完全依赖你想起来再问。 |

这就是循环：上下文进来，xopc 帮你判断下一步；你去行动，再把结果和反馈带回来；系统越用越知道该如何继续推进。

## 安装后你能立刻做什么

- **第一天：** 本地开聊，配置一个模型，让 xopc 跟进一个真实项目。
- **第一周：** 持续丢进展、阻塞点、决策、链接和想法。
- **用顺手后：** 接入你真的会用的入口：桌面、终端、网页、手机扫码配对、Telegram、微信或飞书/Lark。
- **事情开始重复时：** 用自动化做复盘、提醒、摘要和工作流运行。

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

### 最快终端路径

```bash
curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc
```

这条路径会启动本地嵌入式 TUI，不需要先配置网关、桌面端或即时通讯。

### 一键安装（推荐）

**Linux、macOS、WSL2、Termux**

```bash
curl -fsSL https://xopc.ai/install.sh | bash
```

**Windows（原生 PowerShell）**

> **提示：** 原生 Windows 无需 WSL 即可运行 xopc——CLI、网关、TUI 与工具均可在本机使用。若更习惯 WSL2，在 WSL 里执行上面的 bash 命令即可。

在 PowerShell 中运行：

```powershell
iex (irm https://xopc.ai/install.ps1)
```

安装脚本会自动识别系统、在需要时安装 **Node.js ≥ 22**，并安装 **`@xopcai/xopc`**。国内镜像：bash 加 `--cn`，PowerShell 加 `-Cn`，或指定 `--registry https://registry.npmmirror.com`。

> **30 秒启动：** 这是官网推荐路径，覆盖 macOS、Linux 与 Windows 的环境初始化。

### 配置并开聊

```bash
xopc onboard          # 更快：xopc onboard --quick
xopc                  # 等同于 xopc tui，打开本地 TUI
```

> **第一次用？** 想少碰终端，优先用 **PC 桌面端**；习惯终端则直接运行 **`xopc`**。需要浏览器控制台或即时通讯时，再启动 **`xopc gateway`**。

### npm（已具备 Node.js 22+）

```bash
npm install -g @xopcai/xopc
```

也可用 pnpm：`pnpm add -g @xopcai/xopc` · 国内：`npm install -g @xopcai/xopc --registry=https://registry.npmmirror.com`

### 更多命令

```bash
xopc agent -i                    # 经典交互式 CLI
xopc agent -m "总结最近 5 条提交"  # 只问一句

xopc init                        # 完整 ~/.xopc 状态目录（首次安装 / 修复）
xopc gateway                     # 本地网页服务 + React 控制台（地址见终端输出）
xopc gateway service install     # OS 系统服务；xopc gateway stop | status | logs
xopc profile list                # 可选：独立状态 Profile
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

- 🔁 **从聊天自然长成循环** — 先普通对话，再把项目、笔记、外部入口和自动化逐步接上，让长期事情持续滚动。

- 🏠 **你的机器** — 配置与数据在 **`~/.xopc/`**，无强制云端、无意外账单。
- 🔑 **使用自己的密钥** — OpenAI、Anthropic、Google、DeepSeek、Ollama、LM Studio、vLLM 等 **20+** 厂商；云端和本地模型可混用，一行配置即可切换模型。详见 **[模型](https://xopcai.github.io/xopc/zh/models)**。
- 📱 **自己的 Agent，随时可用** — xopc 跑在你的电脑上，[移动端 App](./apps/mobile-expo) 扫码连接。外出时也能继续对话、记录笔记和想法，但项目数据不需要搬到云端聊天账号里。
- 🧩 **可按需扩展** — 通过 **`xopc skills install`** 和 **`xopc extensions install`** 扩展工具、频道与 UI；多 Agent 可按场景隔离。
- ⏰ **支持主动任务** — 用 **自动化** 做定时摘要、提醒与工作流运行；用 **工作流**扇出多子 Agent 任务；用 **多 Agent** 管理不同工作区、工具与系统提示词。

## 和 Codex / Claude Code / QoderWork / WorkBuddy 的区别

xopc 不是要替代所有编程 Agent 或办公 Agent。它更像一个本地优先的系统层：让同一个助手记住长期目标、保留状态、运行自动化，并在多个入口中持续可用。

| 产品 | 更擅长 | 为什么还需要 xopc |
| --- | --- | --- |
| **Codex** | 终端、IDE 和云端的软件开发任务 | xopc 不只服务一个代码仓库：长期目标、BYOK/本地模型、定时循环、Gateway API、桌面/网页/手机和 IM 都共享同一套本地状态。 |
| **Claude Code** | 项目级编码：读代码、改文件、跑测试、处理 git 工作流 | xopc 是面向个人长期工作的 Agent OS：既能服务 coding，也能协调模型、频道、技能、工作流和自动化。 |
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
| **手机** | [移动端 App](./apps/mobile-expo) + 网关扫码配对（[移动端 App](https://xopcai.github.io/xopc/zh/mobile-app)、[远程访问](https://xopcai.github.io/xopc/zh/remote-access)） | 在 iOS/Android 上继续对话、记录 note/idea；Agent 仍运行在你的电脑或本地环境里 |
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

默认路径：**`~/.xopc/xopc.json`**。

```json
{
  "agents": {
    "default": "main",
    "list": [
      {
        "id": "main",
        "identity": { "name": "Main", "role": "General assistant" },
        "responsibilities": { "primary": ["Help the user complete tasks"] },
        "workspace": { "root": "~/.xopc/workspace/main" },
        "models": {
          "defaultRole": "deep",
          "roles": {
            "deep": { "model": "deepseek/deepseek-v4-flash" }
          }
        },
        "tools": { "builtin": {} },
        "skills": { "mode": "all" },
        "memory": { "mode": "confirmWrite", "sources": ["session"] },
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      }
    ]
  },
  "providers": {
    "deepseek": "${DEEPSEEK_API_KEY}"
  }
}
```

需要即时通讯时再补 **`channels.telegram`**、**`channels.weixin`**、**`channels.feishu`** —— 见 **[配置](https://xopcai.github.io/xopc/zh/configuration)**。

可选工具（如浏览器）默认**关闭**，启用后按需安装 Playwright Chromium。

---

## 文档

| 指南 | 说明 |
| --- | --- |
| [快速开始](https://xopcai.github.io/xopc/zh/getting-started) | 安装、向导、第一次对话 |
| [从聊天到数据飞轮](https://xopcai.github.io/xopc/zh/concepts/loops) | xopc 如何从简单聊天逐步长成项目上下文、外部入口和自动化循环 |
| [配置](https://xopcai.github.io/xopc/zh/configuration) | `xopc.json` 字段 |
| [CLI](https://xopcai.github.io/xopc/zh/cli) | 命令与参数 |
| [频道](https://xopcai.github.io/xopc/zh/channels) | Telegram、微信、飞书 |
| [架构](https://xopcai.github.io/xopc/zh/architecture) | 整体结构 |
| [工作流](https://xopcai.github.io/xopc/zh/workflows) | 扇出子 Agent、看板、脚本 |

更多：[工具](https://xopcai.github.io/xopc/zh/tools) · [移动端 App](https://xopcai.github.io/xopc/zh/mobile-app) · [语音](https://xopcai.github.io/xopc/zh/voice) · [远程访问](https://xopcai.github.io/xopc/zh/remote-access)

---

## 常见问题

**xopc 是云服务吗？**  
不是。xopc 跑在你的机器上，配置、工作区文件、凭据和本地状态默认都在 **`~/.xopc/`**。

**必须使用付费云端模型吗？**  
不必须。你可以自带云厂商 API Key，也可以使用 Ollama、LM Studio、vLLM 等本地/自部署模型服务。

**最快怎么试用？**  
对大多数用户，优先从 GitHub Releases 安装 **PC 桌面端**，在界面中完成模型设置。习惯终端的用户可以执行 **`xopc onboard --quick`**，然后运行 **`xopc`**。

**它和普通聊天 UI 有什么区别？**  
xopc 可以从普通聊天开始，但它的组织方式是为了逐步长成目标循环：项目上下文、笔记、外部信号、下一步、反馈和自动化都能在多个入口里继续工作。

**能在手机或即时通讯里用吗？**
可以。建议先用本地 TUI 试用；确认方向后，再启动 gateway，用 [移动端 App](./apps/mobile-expo) 连接 iOS/Android，或配置 Telegram、微信、飞书/Lark。

---

<a id="desktop-app"></a>
<a id="electron-desktop"></a>

## 桌面版

PC 桌面端是大多数用户最省心的开始方式：它会启动内置本地 gateway，并在原生窗口里打开 gateway 控制台。

1. 从 **[GitHub Releases](https://github.com/xopcai/xopc/releases)** 下载 — macOS `.dmg`，Windows `xopc-<版本>-x64.exe` 或 `xopc-<版本>-arm64.exe`，Linux `.AppImage` / `.deb`。
2. 打开应用，完成模型设置，然后开始聊天。
3. 暂无对应平台安装包时，先用 **`xopc gateway`** + npm 命令行版。

**从源码打包：** `pnpm install && pnpm run electron:build` → `dist/release/`

文档与素材预留：**[PC 桌面端](https://xopcai.github.io/xopc/zh/desktop-app)**。

---

## 安全

来自即时通讯的消息视为**不可信输入**。私聊建议 **pairing（配对）** 或 **allowlist（白名单）**。请勿泄露网关监听地址与 token —— **[频道](https://xopcai.github.io/xopc/zh/channels)**。

---

## 参与贡献

```bash
pnpm install && pnpm run dev
pnpm run dev:gateway            # 开发 gateway 使用 ~/.xopc-dev + info 日志
pnpm run build && pnpm test && pnpm run lint
```

**[AGENTS.md](./AGENTS.md)** · **[CONTRIBUTING.md](./CONTRIBUTING.md)**（英文）

**反馈：** [Bug 反馈](https://github.com/xopcai/xopc/issues/new?template=bug_report.yml) · [功能建议](https://github.com/xopcai/xopc/issues/new?template=feature_request.yml) · [Q&A 讨论](https://github.com/xopcai/xopc/discussions/categories/q-a) · [安全漏洞反馈](https://github.com/xopcai/xopc/security/advisories/new)（请勿公开发布漏洞细节）

## 致谢

- 大模型接入：[@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono) · 运行时：[@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
- 灵感来自 [openclaw/openclaw](https://github.com/openclaw/openclaw) 与 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>由 <a href="https://github.com/xopcai">xopcai</a> 维护 · <a href="https://xopc.ai">xopc.ai</a></sub></p>
