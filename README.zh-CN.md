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
      <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
    </a>
  </p>
</div>

## ✨ xopcbot 能做什么？

xopcbot 是运行在本地 的个人 AI 助手，可以帮助你：

| 使用场景 | 示例 |
|----------|------|
| **编程助手** | 调试代码、解释代码片段、编写函数 |
| **任务自动化** | 使用 cron 设置定时任务 |
| **文件操作** | 在工作区中搜索、读取、编辑文件 |
| **网络搜索** | 搜索网页并总结结果 |
| **多渠道聊天** | 通过 Telegram、WhatsApp、飞书或网页 UI 交流 |

```bash
# 在终端中交互式聊天
xopcbot agent -i

# 或发送单条消息
xopcbot agent -m "解释这段代码：function foo() { return 42; }"

# 让 xopcbot 帮你处理 git 任务
xopcbot agent -m "查看最近的提交并创建 PR 摘要"
```

---

## 🚀 快速开始

### 1️⃣ 安装

```bash
# 从 npm 安装（推荐）
npm install -g @xopcai/xopcbot

# 或从源码构建
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot && npm install && npm build
```

### 2️⃣ 配置（交互式向导）

```bash
xopcbot onboard
# 或: npm run dev -- onboard
```

向导会引导你完成：
- 选择喜欢的 AI 模型（支持 20+ 提供商）
- 配置 API 密钥
- 设置聊天渠道（Telegram、WhatsApp 等）

> **提示：** 使用 `xopcbot onboard --quick` 可快速设置模型。

### 3️⃣ 开始聊天！

```bash
# 交互式聊天模式
xopcbot agent -i

# 或使用特定渠道
xopcbot agent -m "你好！" --channel telegram --chat-id 123456
```

---

## 📖 文档

| 指南 | 描述 |
|------|------|
| [快速开始](https://xopcai.github.io/xopcbot/getting-started) | 安装和基本用法 |
| [配置](https://xopcai.github.io/xopcbot/configuration) | 完整配置参考 |
| [CLI 参考](https://xopcai.github.io/xopcbot/cli) | 所有可用命令 |
| [渠道](https://xopcai.github.io/xopcbot/channels) | Telegram、WhatsApp、飞书设置 |
| [工具](https://xopcai.github.io/xopcbot/tools) | 内置工具参考 |

---

## 🔌 支持的渠道

| 渠道 | 状态 | 安装 |
|------|------|------|
| Telegram | ✅ | [设置指南](https://xopcai.github.io/xopcbot/channels#telegram) |
| WhatsApp | ✅ | [设置指南](https://xopcai.github.io/xopcbot/channels#whatsapp) |
| 飞书/Lark | ✅ | [设置指南](https://xopcai.github.io/xopcbot/channels#feishu) |
| 网页 UI | ✅ | 内置，运行 `xopcbot gateway` 即可 |

---

## 🛠️ 开发

```bash
# 开发模式（热重载）
npm run dev

# 构建生产版本
npm run build

# 运行测试
npm test

# 代码检查
npm run lint
```

---

## 🙏 致谢

- LLM 提供商基于 [@mariozechner/pi-ai](https://github.com/badlogic/pi-mono)

---

<div align="center">
  <sub>由 <a href="https://github.com/xopcai">xopcai</a> 用 ❤️ 构建</sub>
</div>
