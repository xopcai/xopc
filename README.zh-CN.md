<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center"><a href="https://xopc.ai">xopc</a></h1>

<p align="center">
  <strong>让重要的事持续向前。</strong><br />
  一个运行在你电脑上的个人 AI，记得你的目标和上下文，<br />
  随时从你停下的地方继续。
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
  <a href="https://xopc.ai/zh#download"><strong>下载桌面应用 →</strong></a> ·
  <a href="#quick-start"><strong>30 秒终端安装</strong></a> ·
  <a href="https://xopcai.github.io/xopc/zh/">查看文档</a>
</p>

<p align="center">
  <a href="https://xopcai.github.io/xopc/zh/desktop-app">
    <img src="docs/public/xopc-desktop.gif" alt="xopc 桌面端演示" width="1200">
  </a>
</p>

> 安装后可以直接告诉它：**“这周我最想推进的一件事是 ____。帮我找到最小但可信的下一步。”**

<details>
<summary><strong>目录</strong></summary>

- [为什么值得试试](#为什么值得试试)
- [快速开始](#快速开始)
- [在哪里聊](#在哪里聊)
- [内置频道](#内置频道)
- [扩展与技能](#扩展与技能)
- [配置示例](#配置示例)
- [文档](#文档)
- [常见问题](#常见问题)
- [安全](#安全)
- [参与贡献](#参与贡献)

</details>

---

## 为什么值得试试

- **不用先整理好。** 直接丢给它文字、语音、文件、链接，或者一句模糊的想法。
- **不用反复解释。** 会话、Project、Task 和可纠正的用户理解会保留真正有用的背景。
- **不只给建议。** 它可以调用工具、运行工作流、验证结果，并在之后继续推进。
- **始终由你控制。** 本地优先，数据源单独授权，发送、删除等高影响操作需要确认。

**让重要的事持续向前。** xopc 把背景、下一步、结果证据和后续跟进留在一起，让重要的事情不会随着一次对话结束而消失。

xopc 可以在桌面、网页、终端、手机、Telegram、微信和飞书中使用；你也可以选择自己的云端模型或本地模型。

想了解完整的产品理念、信任模型和下一阶段方向，请阅读[产品理念](https://xopcai.github.io/xopc/zh/product)。

---

<a id="desktop-app"></a>
<a id="get-started"></a>
<a id="quick-start"></a>

## 快速开始

### 最省心的开始方式：桌面应用

对大多数用户来说，**桌面应用**是最容易上手的方式：安装应用，在界面里完成模型设置，然后直接在内置控制台聊天。它会自动启动本地 gateway。

1. 打开 **[xopc.ai](https://xopc.ai/zh#download)**，选择 macOS、Windows 或 Linux。
2. 打开 xopc，完成模型设置。
3. 开始聊天。

详见 **[桌面应用](https://xopcai.github.io/xopc/zh/desktop-app)**：安装说明、首次使用指引和源码打包命令。

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

大体积的可选运行时只在启用对应功能时安装：

```bash
npm install -g @huggingface/transformers@3.8.1 sherpa-onnx-node@1.13.4
npm install -g @composio/core@0.14.0 @composio/experimental@0.2.0
npm install -g @larksuiteoapi/node-sdk@1.66.0 playwright-core@1.60.0
```

如果 xopc 是项目依赖，请使用不带 `-g` 的相同命令。

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

## 在哪里聊

| 方式 | 怎么用 | 适合 |
| --- | --- | --- |
| **桌面应用** | [前往 xopc.ai 下载](https://xopc.ai/zh#download) | 最省心的开始方式：原生应用 + 内嵌 gateway 控制台 |
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
| [Project、Task 与笔记](https://xopcai.github.io/xopc/zh/projects-tasks-notes) | 用唯一且可验证的 Task 模型推进长期工作，并按需增加 Project 上下文 |
| [分享会话](https://xopcai.github.io/xopc/zh/session-sharing) | 发布经过检查、带有效期和访问上限的只读 Session 快照 |
| [配置](https://xopcai.github.io/xopc/zh/configuration) | `xopc.json` 字段 |
| [CLI](https://xopcai.github.io/xopc/zh/cli) | 命令与参数 |
| [频道](https://xopcai.github.io/xopc/zh/channels) | Telegram、微信、飞书 |
| [架构](https://xopcai.github.io/xopc/zh/architecture) | 整体结构 |
| [工作流](https://xopcai.github.io/xopc/zh/workflows) | 扇出子 Agent、看板、脚本 |

更多：[工具](https://xopcai.github.io/xopc/zh/tools) · [移动端 App](https://xopcai.github.io/xopc/zh/mobile-app) · [语音](https://xopcai.github.io/xopc/zh/voice) · [远程访问](https://xopcai.github.io/xopc/zh/remote-access)

---

## 常见问题

**xopc 是云服务吗？** — 不是。xopc 运行在你的机器上，配置与状态默认保存在 **`~/.xopc/`**。你也可以自行部署 gateway 供其他设备连接。

**“本地优先”是否意味着数据绝不会离开电脑？** — 不一定。如果选择云端模型，与当前请求相关的对话和上下文会发送给对应模型服务商；需要完全留在本机的工作，请使用本地模型并检查数据源和工具权限。

**xopc 会自动记住关于我的一切吗？** — 不会。用户理解可以被查看、确认、纠正和删除；未经确认的推断不应该被当作权威事实。密码、密钥和其他高度敏感信息不应交给记忆系统。

**必须使用付费云端模型吗？** — 不必须。自带 API Key 或用本地模型（Ollama、LM Studio、vLLM）。

**最快怎么试用？** — [桌面端](#快速开始) 适合 GUI 用户，终端用户执行 `xopc onboard --quick && xopc`。

**它和普通聊天 UI 有什么区别？** — 聊天只是入口。xopc 会把对你的理解、长期目标、项目、Task、决定和执行记录保留下来，让同一个助手可以跨越时间和入口继续工作。

**能在手机或即时通讯里用吗？** — 可以。用 [移动端 App](./apps/mobile-expo) 扫码连接，或配置 Telegram、微信、飞书/Lark。

**还有问题？** — 去 [GitHub Discussions](https://github.com/xopcai/xopc/discussions/categories/q-a) 提问。

---

## 安全

xopc 会接触个人上下文，也可能获得执行工具，因此能力边界与模型选择同样重要：

- 只启用当前需要的数据源、工具和频道；
- 使用云端模型前，确认可以发送给服务商的上下文范围；
- 来自即时通讯的消息一律视为**不可信输入**，私聊建议使用 **pairing（配对）** 或 **allowlist（白名单）**；
- 保持 gateway 监听地址、访问 token 和 API Key 私密；
- 对发送、删除、购买以及其他高影响动作保留人工确认。

详见[用户理解与隐私](./docs/user-understanding.md)、[频道安全](https://xopcai.github.io/xopc/zh/channels)和[配置参考](https://xopcai.github.io/xopc/zh/configuration)。

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
- 用户理解：受 [OpenWiki](https://github.com/langchain-ai/openwiki) 从证据沉淀知识的思想启发，在 XOPC 中重新实现为带治理合成和逐轮上下文规划的原生能力，详见[用户理解](./docs/user-understanding.md)
- 灵感来自 [openclaw/openclaw](https://github.com/openclaw/openclaw) 与 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>由 <a href="https://github.com/xopcai">xopcai</a> 维护 · <a href="https://xopc.ai">xopc.ai</a></sub></p>
