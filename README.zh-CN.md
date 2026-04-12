<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">xopc</h1>

<p align="center">
  <strong>超轻量级个人 AI 助手。</strong><br />
  基于 <strong>Node.js</strong> 与 <strong>TypeScript</strong>、在本地运行的 AI 助手—面向<strong>超级个体</strong>的平台。
</p>

<p align="center">
  <a href="https://github.com/xopcai/xopc"><img src="https://img.shields.io/badge/GitHub-xopcai%2Fxopc-181717?style=for-the-badge&amp;logo=github" alt="GitHub"></a>
  <a href="https://xopcai.github.io/xopc/zh/"><img src="https://img.shields.io/badge/Docs-中文文档-228B22?style=for-the-badge" alt="中文文档"></a>
  <a href="#quick-start-tldr"><img src="https://img.shields.io/badge/快速开始-CLI-blue?style=for-the-badge" alt="快速开始"></a>
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

**CLI**、**HTTP/WebSocket 网关**与 **React** 控制台，核心自带 **Telegram**、**微信（Weixin）** 频道插件（含网页控制台）。飞书、Slack、Discord 等走自定义 `ChannelPlugin` 扩展。通过 [@mariozechner/pi-ai](https://github.com/mariozechner/pi-ai) 支持 **20+** 大模型厂商，并提供**扩展**与 **SKILL.md** 技能，**无需改核心**即可扩展。

---

## 亮点

| | |
| --- | --- |
| **超级个体栈** | 自管一体化平台：终端、网关、即时通讯、cron、技能—拼装工作流，而非依赖托管黑盒。 |
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

<a id="quick-start-tldr"></a>

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
