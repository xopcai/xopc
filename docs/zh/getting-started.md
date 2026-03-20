# 快速开始

本指南提供首次设置 **xopcbot** 的完整教程。

## 1. 环境要求

开始前，请确保已安装：

- **Node.js**: 版本 **22.0.0** 或更高 (`node -v`)
- **pnpm**: 推荐的包管理器 (`pnpm --version`)

> **注意:** 本项目使用 `pnpm`。请**不要**使用 `npm` 进行包管理。

## 2. 安装

### 方式一：从 npm 安装（推荐）

```bash
npm install -g @xopcai/xopcbot
```

### 方式二：从源码构建

```bash
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
pnpm install
pnpm run build
```

## 3. 配置

### 交互式设置（推荐）

使用 `onboard` 向导进行引导式设置：

```bash
xopcbot onboard
# 或：pnpm run dev -- onboard
```

向导将引导您完成：
1. 创建工作区目录 (`~/.xopcbot/workspace/`)
2. 生成默认 `config.json`
3. 选择 LLM 提供商并输入 API 密钥
4. 配置消息通道（Telegram）
5. 设置 Gateway WebUI

### 快速设置

仅需基本文件而不需要交互式提示：

```bash
xopcbot setup
```

### 手动配置

直接编辑 `~/.xopcbot/config.json`：

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
    "anthropic": "${ANTHROPIC_API_KEY}"
  }
}
```

> **提示:** 使用环境变量存储 API 密钥（如 `ANTHROPIC_API_KEY`）。

## 4. 首次对话

### 单条消息模式

发送单条消息并获取回复：

```bash
xopcbot agent -m "用一句话解释什么是 LLM。"
# 或：pnpm run dev -- agent -m "用一句话解释什么是 LLM。"
```

### 交互模式

开始连续对话：

```bash
xopcbot agent -i
# 或：pnpm run dev -- agent -i
```

您将看到 `You:` 提示符。输入消息后按 Enter，按 `Ctrl+C` 退出。

## 5. 使用通道运行

### Telegram 设置

1. **获取 Bot Token**: 打开 Telegram，搜索 [@BotFather](https://t.me/BotFather)，发送 `/newbot`

2. **配置** `~/.xopcbot/config.json`：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_BOT_TOKEN",
      "dmPolicy": "allowlist",
      "allowFrom": [123456789]
    }
  }
}
```

3. **启动 Gateway**：

```bash
xopcbot gateway
# 或：pnpm run dev -- gateway
```

4. **聊天**: 打开 Telegram 并与您的机器人对话

### Web UI

启动 gateway 后访问 `http://localhost:18790`。

## 6. 下一步

探索这些指南以解锁更多功能：

| 指南 | 描述 |
|------|------|
| [CLI 参考](/zh/cli) | 所有可用命令 |
| [配置参考](/zh/configuration) | 完整配置参考 |
| [扩展](/zh/extensions) | 扩展功能 |
| [技能](/zh/skills) | 添加领域特定知识 |
| [工具](/zh/tools) | 内置工具参考 |
| [通道](/zh/channels) | 多通道设置 |
| [模型](/zh/models) | LLM 提供商配置 |

## 故障排除

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| `ERR_MODULE_NOT_FOUND` | 运行 `pnpm install` |
| `Cannot find module '@xopcai/...'` | 运行 `pnpm run build` |
| 配置未加载 | 验证 `~/.xopcbot/config.json` 是有效 JSON |
| 机器人无响应 | 检查 `TELEGRAM_BOT_TOKEN` 和机器人状态 |
| API 密钥错误 | 确认环境变量已设置 |

### 获取帮助

- 查看 [文档](/) 获取详细指南
- 查看 [AGENTS.md](https://github.com/xopcai/xopcbot/blob/main/AGENTS.md) 获取开发指南
- 查看日志：`xopcbot gateway logs --follow`
