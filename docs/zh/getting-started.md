# 快速开始

本指南提供首次设置 **xopcbot** 的完整教程，包括安装、配置和在不同模式下运行代理。

## 1. 环境要求

开始前，请确保已安装以下软件：

- **Node.js**：需要版本 **22.0.0** 或更高。可通过 `node -v` 检查版本。
- **npm** 或 **pnpm**：任意包管理器均可。

## 2. 安装

### 方式一：从 npm 安装（推荐）

```bash
# 全局安装
npm install -g @xopcai/xopcbot
# 或：pnpm add -g @xopcai/xopcbot
```

### 方式二：从源码构建

从 GitHub 克隆仓库并安装依赖：

```bash
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
npm install
# 或：pnpm install
```

## 3. 配置

最简单的配置方式是使用交互式 `onboard` 命令：

```bash
npm run dev -- onboard
# 或: pnpm run dev -- onboard
```

该命令将：
1. 创建必要的目录（`~/.xopcbot/` 和 `~/.xopcbot/workspace/`）。
2. 在 `~/.xopcbot/config.json` 生成默认配置文件。
3. 提示选择 LLM 提供商并输入 API 密钥。

您的 API 密钥将安全存储在配置文件中。

### 配置向导流程

```
? 选择 LLM 提供商: openai
? 输入 API 密钥: sk-...
? 启用 Telegram? Yes
? Telegram Bot Token: 123456:...
```

## 4. 首次对话（CLI）

配置完成后，您可以立即通过命令行与代理交互。

#### 单次消息模式

使用 `-m` 标志发送单条消息并接收回复：

```bash
npm run dev -- agent -m "用一句话解释什么是 LLM。"
# 或: pnpm run dev -- agent -m "用一句话解释什么是 LLM。"
```

#### 交互模式

要进行连续对话，使用 `-i` 标志进入交互模式：

```bash
npm run dev -- agent -i
# 或: pnpm run dev -- agent -i
```

您将看到 `You:` 提示符，输入消息后按回车即可。按 `Ctrl+C` 退出。

## 5. 使用通道运行（网关模式）

要将代理连接到 Telegram 等消息平台，需要以**网关模式**运行。

#### a. 配置通道

首先编辑 `~/.xopcbot/config.json` 文件，添加通道所需信息。对于 Telegram，需要 Bot Token：

```jsonc
// ~/.xopcbot/config.json
{
  // ... 其他配置 ...
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "123456:ABC-DEF1234567890", // <-- 在此处添加 Bot Token
      "allowFrom": ["your_telegram_user_id"] // 可选：限制访问用户
    }
  }
}
```

更多详情请参阅[通道文档](/zh/channels)。

#### b. 启动网关

运行 `gateway` 命令。这将启动一个长期运行的进程，连接配置的通道并监听消息。

```bash
npm run dev -- gateway
# 或: pnpm run dev -- gateway
```

现在您可以打开 Telegram 客户端与机器人对话。发送的任何消息都将由代理处理。

#### c. 使用 Web UI

网关启动后，打开浏览器访问：

```
http://localhost:18790
```

您将看到 xopcbot 的 Web 界面，可以：
- 通过网页与代理对话
- 查看和修改配置
- 管理会话

## 6. 工作区模板

`onboard` 命令会在工作区创建以下模板文件：

```
~/.xopcbot/workspace/
├── SOUL.md          # 代理的核心身份和个性
├── USER.md          # 关于您的信息
├── TOOLS.md         # 工具使用说明
├── AGENTS.md        # 代理协作指南
├── MEMORY.md        # 记忆存储
└── memory/          # 记忆片段目录
```

这些文件会自动加载到代理的系统提示中，帮助代理更好地理解上下文。

## 下一步？

您现在拥有一个功能完整的 xopcbot！以下是一些探索建议：

- **[CLI 参考](/zh/cli)**：发现管理机器人的所有可用命令。
- **[配置参考](/zh/configuration)**：了解 `config.json` 中可调整的所有设置。
- **[插件系统](/zh/plugins)**：探索如何通过插件扩展代理功能。
- **[内置工具](/zh/tools)**：了解代理可用的文件系统、Shell 和 Web 工具。
