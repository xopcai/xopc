# CLI 命令参考

xopcbot 提供丰富的 CLI 命令用于管理、对话和配置。

## 命令列表

| 命令 | 描述 |
|------|------|
| `onboard` | 初始化配置和工作区 |
| `agent` | 与 Agent 对话 |
| `gateway` | 启动 REST 网关 |
| `cron` | 管理定时任务 |

---

## onboard

初始化 xopcbot 配置。

```bash
npm run dev -- onboard
```

**功能**：
- 创建配置目录
- 设置默认配置
- 配置 LLM 提供商
- 配置通道 (Telegram/WhatsApp)

**交互提示**：

```
? Select LLM provider: openai
? Enter API key: sk-...
? Enable Telegram? Yes
? Telegram bot token: 123456:...
```

---

## agent

与 Agent 对话。

### 单次对话

```bash
npm run dev -- agent -m "Hello, world!"
```

**参数**：

| 参数 | 描述 |
|------|------|
| `-m, --message` | 发送的消息 |
| `-s, --session` | 会话键 (默认: default) |
| `-i, --interactive` | 交互模式 |

### 交互模式

```bash
npm run dev -- agent -i
```

**使用**：

```
> Hello!
Bot: Hello! How can I help?

> List files
Bot: File listing...

> quit
```

### 指定会话

```bash
npm run dev -- agent -m "Continue our discussion" -s my-session
```

---

## gateway

启动 REST API 网关。

```bash
npm run dev -- gateway --port 18790
```

**参数**：

| 参数 | 描述 |
|------|------|
| `-p, --port` | 端口号 (默认: 18790) |
| `-h, --host` | 绑定地址 (默认: 0.0.0.0) |

**后台运行**：

```bash
nohup npm run dev -- gateway --port 18790 > bot.log 2>&1 &
```

---

## cron

管理定时任务。

### 列出任务

```bash
npm run dev -- cron list
```

**输出**：

```
ID   | Schedule      | Message               | Enabled
-----|---------------|-----------------------|--------
abc1 | 0 9 * * *    | Good morning!         | true
abc2 | */15 * * * * | Reminder every 15m   | false
```

### 添加任务

```bash
npm run dev -- cron add --schedule "0 9 * * *" --message "Good morning!"
```

**参数**：

| 参数 | 描述 |
|------|------|
| `--schedule` | Cron 表达式 |
| `--message` | 定时发送的消息 |
| `--name` | 任务名称 (可选) |

**示例**：

```bash
# 每天 9 点
npm run dev -- cron add --schedule "0 9 * * *" --message "Daily update"

# 工作日 18 点
npm run dev -- cron add --schedule "0 18 * * 1-5" --message "Time to wrap up!"

# 每小时提醒
npm run dev -- cron add --schedule "0 * * * *" --message "Hourly reminder" --name hourly
```

### 删除任务

```bash
npm run dev -- cron remove <task-id>
```

**示例**：

```bash
npm run dev -- cron remove abc1
```

### 启用/禁用

```bash
npm run dev -- cron enable <task-id>
npm run dev -- cron disable <task-id>
```

### 触发任务

```bash
npm run dev -- cron trigger <task-id>
```

---

## 全局选项

### 工作区路径

```bash
--workspace /path/to/workspace
```

### 配置文件

```bash
--config /path/to/config.json
```

### 详细输出

```bash
--verbose
```

### 帮助信息

```bash
npm run dev -- --help
npm run dev -- agent --help
npm run dev -- gateway --help
```

---

## 快捷脚本

创建快捷脚本 `bot`：

```bash
#!/bin/bash

case "$1" in
  chat)
    npm run dev -- agent -m "${*:2}"
    ;;
  shell)
    npm run dev -- agent -i
    ;;
  start)
    npm run dev -- gateway --port 18790
    ;;
  cron)
    shift
    npm run dev -- cron "$@"
    ;;
  *)
    echo "Usage: bot {chat|shell|start|cron}"
    ;;
esac
```

使用：

```bash
bot chat Hello!
bot start
bot cron list
```

---

## 退出码

| 退出码 | 描述 |
|--------|------|
| `0` | 成功 |
| `1` | 通用错误 |
| `2` | 参数错误 |
| `3` | 配置错误 |
