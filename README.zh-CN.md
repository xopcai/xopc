# xopc

[English README](README.md) | **简体中文**

**xopc** 是运行在您自己环境里的**个人 AI 助手**：**命令行**、带 **React 控制台**的 **HTTP/WebSocket 网关**，以及核心内置的 **Telegram** 与**微信（Weixin）** 两个频道插件，让同一套 Agent 在 IM 与浏览器里都能对话。基于 **Node.js 22+** 与 **TypeScript**，通过 [@mariozechner/pi-ai](https://github.com/mariozechner/pi-ai) 接入 **20+** 大模型厂商，并支持**扩展**与 **SKILL.md 技能**。

当前**开箱即用的即时通讯频道只有 Telegram 与微信**；飞书、Slack、Discord 等**不在核心仓库内**，需要自行实现 `ChannelPlugin` 扩展。

[GitHub](https://github.com/xopcai/xopc) · [中文文档](https://xopcai.github.io/xopc/zh/) · [模型](https://xopcai.github.io/xopc/zh/models) · [配置](https://xopcai.github.io/xopc/zh/configuration) · [CLI](https://xopcai.github.io/xopc/zh/cli)

<p align="center">
  <a href="https://github.com/xopcai/xopc"><img src="https://img.shields.io/badge/GitHub-xopcai/xopc-blue" alt="GitHub"></a>
  <a href="https://xopcai.github.io/xopc/zh/"><img src="https://img.shields.io/badge/Docs-文档-brightgreen" alt="Docs"></a>
  <a href="#"><img src="https://img.shields.io/badge/Node-%3E%3D22.0.0-brightgreen" alt="Node"></a>
  <a href="#"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
</p>

---

## 亮点

| | |
| --- | --- |
| **终端优先** | `agent` 交互模式、`-m` 单次提问、结合 cron 的定时任务。 |
| **网关 + Web 控制台** | REST、SSE、WebSocket；React 控制台（Vite + Tailwind v4）。 |
| **频道** | **Telegram**（多账号、流式、语音、文件、策略）；**微信**（网关所在机扫码登录、`channels.weixin`）；另含网关自带的 **网页** 对话界面。 |
| **模型** | OpenAI、Anthropic、Google、Groq、DeepSeek、OpenRouter、Ollama、Bedrock、Vertex、OAuth、本地推理等——配置切换，无需改代码。 |
| **扩展与技能** | 扩展包、SKILL.md 与技能工作流（见文档）。 |
| **工作区工具** | 读/写/搜文件、网页搜索、可选浏览器工具、长任务进度反馈。 |

---

## 快速安装

**运行环境：** Node.js **≥ 22**。

```bash
npm install -g @xopcai/xopc
# 或: pnpm add -g @xopcai/xopc
```

**推荐首次运行：** 交互式 onboarding（模型、密钥、频道等）。

```bash
xopc onboard
# 仅快速配模型: xopc onboard --quick
```

然后在终端聊天，或启动网关以使用网页控制台与 IM 机器人。

---

## 快速上手（TL;DR）

```bash
# 终端交互
xopc agent -i

# 单条消息
xopc agent -m "总结最近 5 条提交"

# 网关（REST/SSE + 静态控制台），具体 URL 见日志或 gateway 配置
xopc gateway

# 从源码克隆开发（无需先 build）
pnpm install && pnpm run dev -- agent -i
```

从源码构建请使用 **pnpm**（`pnpm run build`）。仓库结构与约定见 [AGENTS.md](./AGENTS.md)。

---

## CLI 与网关（对照）

| 目的 | 命令 / 流程 |
| --- | --- |
| 在终端聊天 | `xopc agent -i` 或 `xopc agent -m "…"` |
| 打开网页控制台 | 运行 `xopc gateway`，按日志或配置访问 |
| 使用 Telegram / 微信 | 在 `~/.xopc/xopc.json` 配置 `channels.telegram` / `channels.weixin` 并运行网关；微信可在网关主机执行 `xopc channels login --channel weixin` 扫码登录 |
| 引导配置 | `xopc onboard` |
| 定时任务 | 在配置中启用 `cron`；详见[文档](https://xopcai.github.io/xopc/zh/) |

完整子命令与参数：[CLI 参考](https://xopcai.github.io/xopc/zh/cli)。

---

## 安全（私信与网关）

来自聊天应用的入站消息应视为**不可信输入**。建议在弄清风险前对私信使用 **pairing（配对）** 或 **allowlist（白名单）**，并限制群聊中谁可以 @ 机器人。

- 策略说明：[频道](https://xopcai.github.io/xopc/zh/channels)与配置文档。
- 网关令牌与监听地址：把网关当作管理面 API，注意绑定范围与保密。

---

## 文档

| 指南 | 说明 |
| --- | --- |
| [快速开始](https://xopcai.github.io/xopc/zh/getting-started) | 安装、引导、首次对话 |
| [配置](https://xopcai.github.io/xopc/zh/configuration) | `config.json` 说明 |
| [CLI](https://xopcai.github.io/xopc/zh/cli) | 命令与参数 |
| [频道](https://xopcai.github.io/xopc/zh/channels) | Telegram、微信、策略 |
| [扩展](https://xopcai.github.io/xopc/zh/extensions) | 扩展系统 |
| [工具](https://xopcai.github.io/xopc/zh/tools) | 内置工具 |
| [技能](https://xopcai.github.io/xopc/zh/skills) | 技能与 SKILL.md |
| [架构](https://xopcai.github.io/xopc/zh/architecture) | 组成说明 |

---

## 支持的频道

核心仅内置 **Telegram** 与**微信（Weixin）** 两个 IM 插件（源码在 `extensions/telegram`、`extensions/weixin`）：

| 频道 | 说明 |
| --- | --- |
| Telegram | 多账号、流式预览、语音（STT/TTS）、文件、白名单 / 群策略 |
| 微信（Weixin） | 在运行网关的机器上扫码登录、私聊/群策略、`channels.weixin` |
| 网页 | 网关自带的 React 控制台，通过浏览器使用 |

**不包含**飞书/Lark、Slack、Discord 等；若需支持，请自行开发并注册 `ChannelPlugin` 扩展。

---

## 开发

```bash
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install
pnpm run dev          # 通过 tsx 跑 CLI
pnpm run build        # Node + 网页控制台 → dist
pnpm test
pnpm run lint
```

---

## 配置示例

默认配置文件：**`~/.xopc/xopc.json`**（可用环境变量 `XOPC_CONFIG` 覆盖）。

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

微信的完整字段与登录流程见 [频道文档](https://xopcai.github.io/xopc/zh/channels)。更多选项见 [配置参考](https://xopcai.github.io/xopc/zh/configuration)。

---

## 致谢

- LLM 接入：[@mariozechner/pi-ai](https://github.com/mariozechner/pi-ai)
- Agent 运行时：[@mariozechner/pi-agent-core](https://github.com/mariozechner/pi-mono)

---

<p align="center"><sub>由 <a href="https://github.com/xopcai">xopcai</a> 维护</sub></p>
