<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center"><a href="https://xopc.ai">xopc</a></h1>

<p align="center">
  <strong>与你一起成长的 OPC 工作站。</strong><br />
  可自托管的本地优先 AI——为一人公司准备；终端、浏览器、桌面、手机与 IM，一处配置，同一个大脑。<br />
  自带钥匙，无需 fork 即可扩展。
</p>

<p align="center">
  <sub><em>OPC = 一人公司（One-Person Company）——随你成长的工作站。</em></sub>
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
  <a href="https://xopcai.github.io/xopc/zh/">中文文档</a> ·
  <a href="#get-started">快速开始</a> ·
  <a href="https://github.com/xopcai/xopc/releases">Releases</a>
</p>

<p align="center">
  <img src="docs/public/xopc-tui.gif" alt="xopc 终端界面演示" width="720">
</p>

---

<a id="get-started"></a>
<a id="quick-start"></a>

## 快速开始

安装、向导、开聊——三条命令：

```bash
npm install -g @xopcai/xopc
xopc onboard          # 更快：xopc onboard --quick
xopc tui --local
```

> **第一次用？** 先跑 **`xopc tui --local`**（本地嵌入式对话，不用网关）。需要 **网页控制台** 或 **Telegram / 微信 / 飞书** 时再执行 **`xopc gateway`**。

**环境：** Node.js **≥ 22**。在本仓库开发建议用 **pnpm**。

**中国大陆用户：** `npm install` 可加 `--registry=https://registry.npmmirror.com`，或 `npm config set registry https://registry.npmmirror.com`。

### 更多命令

```bash
xopc agent -i                    # 经典交互式 CLI
xopc agent -m "总结最近 5 条提交"  # 只问一句

xopc gateway                     # 本地网页服务 + React 控制台（地址见终端输出）
xopc gateway --background        # 后台常驻；停服 xopc gateway stop | status | logs
```

**从源码开发：**

```bash
git clone https://github.com/xopcai/xopc.git && cd xopc
pnpm install && pnpm run dev -- agent -i
pnpm run build    # Node + 网页 → dist/
```

---

## 为什么选 xopc

- 🏠 **你的机器** — 配置与数据在 **`~/.xopc/`**，无强制云端、无意外账单。
- 🔑 **自带钥匙** — DeepSeek（推荐）、OpenAI、Anthropic、Ollama、LM Studio、vLLM 等 **20+** 厂商；云端本地可混用，一行配置换模型。详见 **[模型](https://xopcai.github.io/xopc/zh/models)**。
- 📱 **一个大脑，处处可用** — 终端、浏览器、桌面、手机、IM 同一套助手，无需另做同步。
- 🧩 **随你长大** — **`xopc skills install`** · **`xopc extensions install`** 扩展工具、频道与 UI；多 Agent 按场景隔离。
- ⏰ **能主动干活** — **Cron** 定时摘要与提醒；**多 Agent** 各自工作区、工具与系统提示词。

---

## 在哪里聊

| 方式 | 怎么用 | 适合 |
| --- | --- | --- |
| **TUI** | `xopc tui --local`（或 `xopc tui --url …`） | 全键盘、流式输出，上手最快 |
| **CLI** | `xopc agent -i` / `xopc agent -m "…"` | 脚本、最小终端环境 |
| **网页** | `xopc gateway` → 打开控制台地址 | 聊天、设置、日志 |
| **桌面** | [GitHub Releases](#desktop-app) 或 `pnpm run electron:build` | 原生应用（macOS / Windows / Linux） |
| **手机** | 与网关配对（[远程访问](https://xopcai.github.io/xopc/zh/remote-access)） | 外出也能用 |
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

更多：[工具](https://xopcai.github.io/xopc/zh/tools) · [语音](https://xopcai.github.io/xopc/zh/voice) · [远程访问](https://xopcai.github.io/xopc/zh/remote-access)

---

<a id="desktop-app"></a>
<a id="electron-desktop"></a>

## 桌面版

1. 从 **[GitHub Releases](https://github.com/xopcai/xopc/releases)** 下载（`.dmg` / `.exe` / `.AppImage` / `.deb`）。
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

## 致谢

- 大模型接入：[@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono) · 运行时：[@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
- 灵感来自 [openclaw/openclaw](https://github.com/openclaw/openclaw) 与 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>由 <a href="https://github.com/xopcai">xopcai</a> 维护 · <a href="https://xopc.ai">xopc.ai</a></sub></p>
