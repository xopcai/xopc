<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center"><a href="https://xopc.ai">xopc</a></h1>

<p align="center">
  <strong>把目标变成循环。</strong><br />
  让真正重要的事情，持续向前。<br />
  XOPC 是一个 Local-first AI 系统，持续记住上下文，协调 AI 推进下一步，让长期目标不断向前。
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

- **长期项目** —— 把目标变成可持续的循环：上下文、下一步行动、反馈和重新校准始终连在一起。
- **独立开发者 / One Person Company** —— 同一个助手覆盖 CLI、TUI、网页、桌面、Telegram、微信和飞书/Lark。
- **本地优先 AI 工作流** —— 自带 API Key，云端/本地模型混用，支持 skills/extensions，数据默认在 **`~/.xopc/`**。

---

<a id="get-started"></a>
<a id="quick-start"></a>

## 快速开始

### 3 分钟试用

```bash
curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc tui --local
```

这条路径会启动本地嵌入式 TUI，不需要先配置网关、桌面端或 IM。

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
xopc tui --local
```

> **第一次用？** 先跑 **`xopc tui --local`**（本地嵌入式对话，不用网关）。需要 **网页控制台** 或 **Telegram / 微信 / 飞书** 时再执行 **`xopc gateway`**。

如果首次运行顺利，欢迎 **[给仓库点个 Star](https://github.com/xopcai/xopc)**，帮助更多人发现这个项目。

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

**环境：** Node.js **≥ 22**（一键脚本会自动处理）。在本仓库魔改请用 **pnpm**。更多安装方式见 **[xopc.ai](https://xopc.ai)** 与 **[快速开始](https://xopcai.github.io/xopc/zh/getting-started)**。

---

## 为什么选 xopc

- 🔁 **循环驱动，而非一次性对话** — XOPC 持续记住上下文，协调 AI 推进下一步，让真正重要的事情不断向前。

- 🏠 **你的机器** — 配置与数据在 **`~/.xopc/`**，无强制云端、无意外账单。
- 🔑 **自带钥匙** — OpenAI、Anthropic、Google、DeepSeek、Ollama、LM Studio、vLLM 等 **20+** 厂商；云端本地可混用，一行配置切换目录模型。详见 **[模型](https://xopcai.github.io/xopc/zh/models)**。
- 📱 **一个大脑，处处可用** — 终端、浏览器、桌面、[移动端 app](https://github.com/xopcai/xopc-app)、IM 同一套助手，无需另做同步。
- 🧩 **随你长大** — **`xopc skills install`** · **`xopc extensions install`** 扩展工具、频道与 UI；多 Agent 按场景隔离。
- ⏰ **能主动干活** — **Cron** 定时摘要与提醒；**工作流**扇出多子 Agent 任务；**多 Agent** 各自工作区、工具与系统提示词。

---

## 在哪里聊

| 方式 | 怎么用 | 适合 |
| --- | --- | --- |
| **TUI** | `xopc tui --local`（或 `xopc tui --url …`） | 全键盘、流式输出，上手最快 |
| **CLI** | `xopc agent -i` / `xopc agent -m "…"` | 脚本、最小终端环境 |
| **网页** | `xopc gateway` → 打开控制台地址 | 聊天、设置、日志 |
| **桌面** | [GitHub Releases](#desktop-app) 或 `pnpm run electron:build` | 原生应用（macOS / Windows / Linux） |
| **手机** | [xopc-app](https://github.com/xopcai/xopc-app) + 网关配对（[移动端 app](https://xopcai.github.io/xopc/zh/mobile-app)、[远程访问](https://xopcai.github.io/xopc/zh/remote-access)） | 在 iOS/Android 上继续推进循环 |
| **即时通讯** | 配置 `channels.*` 并启动网关 | Telegram、微信、飞书/Lark |

---

## 内置频道

在 **`~/.xopc/xopc.json`** 里配置 **`channels.*`**。IM 需网关常驻；微信在**跑网关的机器**上扫码登录。

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
    "defaults": {
      "model": "deepseek/deepseek-chat",
      "max_tokens": 8192
    }
  },
  "providers": {
    "deepseek": "${DEEPSEEK_API_KEY}",
    "openai": "${OPENAI_API_KEY}"
  }
}
```

需要 IM 时再补 **`channels.telegram`**、**`channels.weixin`**、**`channels.feishu`** —— 见 **[配置](https://xopcai.github.io/xopc/zh/configuration)**。

可选工具（如浏览器）默认**关闭**，启用后按需安装 Playwright Chromium。

---

## 文档

| 指南 | 说明 |
| --- | --- |
| [快速开始](https://xopcai.github.io/xopc/zh/getting-started) | 安装、向导、第一次对话 |
| [配置](https://xopcai.github.io/xopc/zh/configuration) | `xopc.json` 字段 |
| [CLI](https://xopcai.github.io/xopc/zh/cli) | 命令与参数 |
| [频道](https://xopcai.github.io/xopc/zh/channels) | Telegram、微信、飞书 |
| [架构](https://xopcai.github.io/xopc/zh/architecture) | 整体结构 |
| [工作流](https://xopcai.github.io/xopc/zh/workflows) | 扇出子 Agent、看板、脚本 |

更多：[工具](https://xopcai.github.io/xopc/zh/tools) · [移动端 app](https://xopcai.github.io/xopc/zh/mobile-app) · [语音](https://xopcai.github.io/xopc/zh/voice) · [远程访问](https://xopcai.github.io/xopc/zh/remote-access)

---

## 常见问题

**xopc 是云服务吗？**  
不是。xopc 跑在你的机器上，配置、工作区文件、凭据和本地状态默认都在 **`~/.xopc/`**。

**必须使用付费云端模型吗？**  
不必须。你可以自带云厂商 API Key，也可以使用 Ollama、LM Studio、vLLM 等本地/自部署模型服务。

**最快怎么试用？**  
执行 **`xopc onboard --quick`** 和 **`xopc tui --local`**。这条路径不会先要求你配置网关、桌面端或 IM。

**它和普通聊天 UI 有什么区别？**  
xopc 围绕目标循环组织：方向、下一步、反馈、重新校准，并且同一个助手可以跨多个入口继续工作。

**能在手机或 IM 里用吗？**  
可以。建议先用本地 TUI 试用；确认方向后，再启动 gateway，用 [xopc-app](https://github.com/xopcai/xopc-app) 连接 iOS/Android，或配置 Telegram、微信、飞书/Lark。

如果这些回答解决了你的顾虑，欢迎 **[给 xopc 点个 Star](https://github.com/xopcai/xopc)**，帮助更多开发者看到它。

---

<a id="desktop-app"></a>
<a id="electron-desktop"></a>

## 桌面版

1. 从 **[GitHub Releases](https://github.com/xopcai/xopc/releases)** 下载 — macOS `.dmg`，Windows `xopc-<版本>-x64.exe` 或 `xopc-<版本>-arm64.exe`，Linux `.AppImage` / `.deb`。
2. 暂无对应平台安装包时，先用 **`xopc gateway`** + npm 命令行版。

**从源码打包：** `pnpm install && pnpm run electron:build` → `dist/release/`

---

## 安全

来自 IM 的消息视为**不可信输入**。私聊建议 **pairing（配对）** 或 **allowlist（白名单）**。网关监听地址与 token 勿泄露 —— **[频道](https://xopcai.github.io/xopc/zh/channels)**。

---

## 参与贡献

```bash
pnpm install && pnpm run dev
pnpm run build && pnpm test && pnpm run lint
```

**[AGENTS.md](./AGENTS.md)** · **[CONTRIBUTING.md](./CONTRIBUTING.md)**（英文）

**反馈：** [Bug](https://github.com/xopcai/xopc/issues/new?template=bug_report.yml) · [功能建议](https://github.com/xopcai/xopc/issues/new?template=feature_request.yml) · [Discussions Q&A](https://github.com/xopcai/xopc/discussions/categories/q-a) · [安全 advisory](https://github.com/xopcai/xopc/security/advisories/new)（勿公开贴漏洞）

---

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=xopcai/xopc&type=Date)](https://star-history.com/#xopcai/xopc&Date)

---

## 致谢

- 大模型接入：[@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono) · 运行时：[@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
- 灵感来自 [openclaw/openclaw](https://github.com/openclaw/openclaw) 与 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>由 <a href="https://github.com/xopcai">xopcai</a> 维护 · <a href="https://xopc.ai">xopc.ai</a></sub></p>
