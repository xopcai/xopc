# 快速上手指南

本指南将帮助你完成 xopcbot 的首次安装、配置和基本使用。

## 前置要求

- **Node.js**: 22.x 或更高版本
- **npm**: 10.x 或更高版本
- **Git**: 用于克隆仓库

检查版本：

```bash
node --version   # 应显示 v22.x.x
npm --version
```

## 安装步骤

### 1. 克隆仓库

```bash
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
```

### 2. 安装依赖

```bash
npm install
```

### 3. 初始化配置

运行初始化向导：

```bash
npm run dev -- onboard
```

按照提示完成：
- 选择 LLM 提供商
- 输入 API Key
- 配置 Telegram (可选)
- 配置 WhatsApp (可选)

### 4. 测试运行

```bash
# 发送一条测试消息
npm run dev -- agent -m "Hello, xopcbot!"
```

你应该能看到 AI 的回复。

---

## 首次配置

初始化后，配置文件位于 `~/.config/xopcbot/config.json`。

### 基本配置示例

```json
{
  "providers": {
    "openai": {
      "api_key": "sk-..."
    }
  },
  "agents": {
    "defaults": {
      "model": "gpt-4o"
    }
  }
}
```

### 添加 Anthropic

```json
{
  "providers": {
    "openai": { "api_key": "sk-..." },
    "anthropic": { "api_key": "sk-ant-..." }
  },
  "agents": {
    "defaults": {
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

完整配置说明请参阅 [配置文档](configuration.md)。

---

## 使用方式

### 1. CLI 交互

**单次对话**：

```bash
npm run dev -- agent -m "What is the capital of France?"
```

**交互模式**：

```bash
npm run dev -- agent -i
```

退出交互模式：输入 `quit` 或按 `Ctrl+C`。

### 2. 启动网关服务

```bash
npm run dev -- gateway --port 18790
```

启动后，可以通过 REST API 与机器人交互。

### 3. Telegram 通道

确保配置中启用了 Telegram：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN"
    }
  }
}
```

获取 Bot Token：[@BotFather](https://t.me/BotFather)

### 4. 定时任务

**查看任务**：

```bash
npm run dev -- cron list
```

**添加任务**：

```bash
npm run dev -- cron add --schedule "0 9 * * *" --message "Good morning!"
```

**删除任务**：

```bash
npm run dev -- cron remove <task-id>
```

Cron 格式：`分 时 日 月 周`

---

## 常用命令速查

| 命令 | 说明 |
|------|------|
| `npm run dev -- onboard` | 初始化配置 |
| `npm run dev -- agent -m "消息"` | 发送单条消息 |
| `npm run dev -- agent -i` | 交互式对话 |
| `npm run dev -- gateway --port <端口>` | 启动网关 |
| `npm run dev -- cron list` | 列出定时任务 |
| `npm run dev -- cron add --schedule "..." --message "..."` | 添加任务 |
| `npm run dev -- cron remove <id>` | 删除任务 |
| `npm run lint` | 检查代码风格 |
| `npm run build` | TypeScript 编译 |

---

## 常见问题

### Q: 提示 "Model not found"

确保模型名称正确，提供商配置已添加。

```json
{
  "providers": {
    "openai": { "api_key": "..." }
  },
  "agents": {
    "defaults": {
      "model": "gpt-4o"
    }
  }
}
```

### Q: API Key 无效

- 检查 Key 是否正确
- 确认 Key 有足够权限
- 查看环境变量是否覆盖了配置文件

### Q: Node.js 版本不兼容

使用 nvm 切换版本：

```bash
nvm install 22
nvm use 22
```

### Q: Telegram 连接失败

- 确认 Bot Token 正确
- 检查网络连接
- 确认 `channels.telegram.enabled` 设为 `true`

### Q: 如何切换模型

编辑 `~/.config/xopcbot/config.json`：

```json
{
  "agents": {
    "defaults": {
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

---

## 下一步

- 📖 [配置详解](configuration.md) - 了解所有配置选项
- 🤖 [模型配置](models.md) - 设置 LLM 模型
- 📱 [通道配置](channels.md) - Telegram / WhatsApp
- 🔧 [工具使用](tools.md) - 内置工具说明
- 🔌 [插件系统](plugins.md) - 扩展功能
