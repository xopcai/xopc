# 🐈 xopcbot: 超轻量级个人 AI 助手

<div align="center">
  <p>
    <strong>使用 Node.js 和 TypeScript 构建的超轻量级、插件驱动的个人 AI 助手。</strong>
  </p>
  <p>
    <a href="https://github.com/xopcai/xopcbot">
      <img src="https://img.shields.io/badge/GitHub-xopcai/xopcbot-blue" alt="GitHub">
    </a>
    <a href="https://xopcai.github.io/xopcbot/">
      <img src="https://img.shields.io/badge/Docs-xopcai.github.io/xopcbot-brightgreen" alt="Docs">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/Node-%3E%3D22.0.0-brightgreen" alt="Node">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/TypeScript-5.x-blue" alt="TypeScript">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
    </a>
  </p>
</div>

**xopcbot** 以极简的代码量（约 6,000 行 TypeScript）提供个人 AI 代理的核心功能。设计简洁、可扩展、易于理解。

## ✨ 特性

- **🤖 统一 LLM API** - 支持 20+ 提供商（OpenAI、Anthropic、Google、Groq、DeepSeek、Minimax、Qwen、Kimi 等）
- **🔌 可扩展插件** - 支持热加载的自定义工具、钩子和命令
- **📱 多渠道支持** - Telegram、WhatsApp、飞书/Lark 或 Web UI
- **🧠 持久记忆** - 对话历史，自动上下文压缩
- **📂 会话管理** - 通过 CLI 或 Web UI 浏览、搜索、归档和管理对话
- **🔧 丰富的内置工具** - 文件系统、Shell、Web 搜索、grep、查找、编辑等
- **⏰ 定时任务** - 基于 Cron 的自动化
- **🖥️ 强大的 CLI** - 从命令行管理代理、配置和插件
- **🌐 现代 Web UI** - 聊天、会话、Cron、子代理、日志和设置

---

## 🚀 快速开始

### 方式一：从 npm 安装

```bash
# 全局安装
npm install -g @xopcai/xopcbot

# 配置（交互式设置）
xopcbot configure

# 开始聊天！
xopcbot agent -i
```

### 方式二：从源码构建

```bash
# 克隆并安装
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
pnpm install

# 配置（交互式设置）
pnpm run dev -- configure

# 开始聊天！
pnpm run dev -- agent -i
```

> **提示：** 运行 `xopcbot configure`（或 `pnpm run dev -- configure`）交互式设置 LLM 提供商 API 密钥。

---

## 📖 文档

完整文档请访问 **[xopcai.github.io/xopcbot](https://xopcai.github.io/xopcbot/)**

| 指南 | 描述 |
|------|------|
| [快速开始](https://xopcai.github.io/xopcbot/getting-started) | 安装和基本用法 |
| [配置](https://xopcai.github.io/xopcbot/configuration) | 完整配置参考 |
| [CLI 参考](https://xopcai.github.io/xopcbot/cli) | 所有可用命令 |
| [渠道](https://xopcai.github.io/xopcbot/channels) | Telegram、WhatsApp、飞书设置 |
| [插件](https://xopcai.github.io/xopcbot/plugins) | 构建你自己的插件 |
| [工具](https://xopcai.github.io/xopcbot/tools) | 内置工具参考 |
| [架构](https://xopcai.github.io/xopcbot/architecture) | 底层实现 |

---

## 💬 支持的渠道

| 渠道 | 状态 | 描述 |
|------|------|------|
| Telegram | ✅ | Bot API，支持轮询/webhook |
| WhatsApp | ✅ | Baileys WebSocket |
| 飞书/Lark | ✅ | WebSocket 事件 |
| Web UI | ✅ | 现代浏览器界面 |

---

## 🛠️ 开发

```bash
# 开发模式
pnpm run dev

# 构建
pnpm run build

# 测试
pnpm test

# 代码检查
pnpm run lint
```

---

## 🙏 致谢

- 灵感来自 [OpenClaw](https://github.com/openclaw/openclaw)
- LLM 提供商基于 [@mariozechner/pi-ai](https://github.com/badlogic/pi-mono)

---

<div align="center">
  <sub>由 <a href="https://github.com/xopcai">xopcai</a> 用 ❤️ 构建</sub>
</div>
