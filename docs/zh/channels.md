# 通道配置

xopcbot 支持多种通信通道，采用基于扩展的架构。**核心配置**（`src/config/schema.ts`）在 `channels` 下明确定义 **`telegram`** 与 **`weixin`**；其余键名可通过 **`.passthrough()`** 保留，供扩展写入。

## 概述

| 通道 | 状态 | 功能 |
|------|------|------|
| **Telegram** | ✅ | Bot Token 或多账号 JSON、流式、语音、文档 |
| **微信（Weixin）** | ✅ | 在网关所在机扫码登录、私聊策略、可选按账号 JSON |
| **网页（Web UI）** | ✅ | 网关控制台内嵌聊天，与其它客户端共用 HTTP API |

其它第三方或实验性通道可作为**扩展**接入，仍可能出现在 `channels.<id>` 中（视构建与扩展而定）。

## 网关控制台 — IM 频道

网关运行时可使用 React 控制台中的 **IM 频道** 专页：

- **路由：** `#/channels`（侧栏 **IM 频道**）。
- **前提：** 已在设置中保存 **网关 Token**，以便调用需鉴权的 API。
- **当前产品界面：** 仅配置 **微信** 与 **Telegram**（与核心 `channels` 结构一致）。

### 微信

- 弹窗内 **扫码登录**，与网关交互：
  - `POST /api/channels/weixin/login/start` — 创建会话并返回二维码载荷。
  - `GET /api/channels/weixin/login/:sessionKey` — 轮询直至完成；凭据写入 **运行网关的本机**（不会上传到云端）。
- 登录成功后从 `GET /api/config` 刷新表单。可选 **高级选项**（白名单、`dmPolicy`、`streamMode`、多账号 JSON 等）在同一弹窗内编辑并通过 **保存** 写入配置。
- 也可在网关主机用 CLI 登录，例如：`pnpm run dev -- channels login --channel weixin`（具体以本机安装与 `--help` 为准）。

### Telegram

- 弹窗表单：Bot Token、白名单、启用开关及 **高级选项**（API 根地址、代理、策略、多账号 JSON 等）。
- **保存** 通过 `PATCH /api/config` 写入 `channels.telegram`，并保留配置中其它字段。

### 命令行配置（与网关共用配置文件）

网关与 CLI 使用同一份 JSON（默认 `~/.xopcbot/config.json`；也可用环境变量 `XOPCBOT_CONFIG` 或命令行全局参数 `--config` 指定）。可在不使用浏览器控制台的情况下配置频道：

**Telegram**

- **交互向导：** `xopcbot onboard --channels` — 引导填写 Bot Token、私聊/群组策略与白名单等，并写入 `channels.telegram`。
- **手动 / 环境变量：** 在环境中设置 `TELEGRAM_BOT_TOKEN`，或直接编辑配置文件中的 `channels.telegram`（含多机器人时的 `accounts`）。

**微信（Weixin / ilink）**

- **终端扫码登录：** `xopcbot channels login --channel weixin` — 使用微信扫码；凭据保存在 **执行命令的本机**（扩展状态目录；默认也会合并 `channels.weixin`，除非使用 `--credentials-only`）。
- **常用参数：** `--account <id>` 用于已有机器人重新登录，`--timeout <ms>`（默认 480000），`--credentials-only` 仅保存 token 相关文件、不合并主配置 JSON。
- 详见 `xopcbot channels login --help`。

通过 CLI 修改凭据或启用状态后，若网关已在运行，请 **重启或热加载网关**，以便频道进程加载新配置。

### 列表行（配置完成后）

当通道被视为 **已配置**（例如 Telegram：已填 Token 或有 `accounts`；微信：已启用、或有 `accounts`、或 `allowFrom` 非空等），卡片展示 **已连接**、**⋯** 菜单（**编辑配置** / **移除配置**）以及 **开关**（立即通过同一配置接口持久化）。**移除配置** 会将该通道块恢复为默认值并保存。

配置写入 **网关配置文件**（默认 `~/.xopcbot/config.json`，或由 `XOPCBOT_CONFIG` 指定）。

## 微信（Weixin）通道

### 最小配置示例

```json
{
  "channels": {
    "weixin": {
      "enabled": true,
      "dmPolicy": "pairing",
      "allowFrom": [],
      "streamMode": "partial",
      "historyLimit": 50,
      "textChunkLimit": 4000,
      "routeTag": "",
      "accounts": {}
    }
  }
}
```

- **`dmPolicy`**：与 Telegram 同一套（`pairing`、`allowlist`、`open`、`disabled`）。
- **`allowFrom`**：在需要白名单式私聊策略时，填写允许的 wxid / openid。
- **`accounts`**：可选，按账号覆盖（名称、`cdnBaseUrl`、`routeTag`、策略等），详见 `src/config/schema.ts` 中 `WeixinConfigSchema` / `WeixinAccountConfigSchema`。

修改凭据后若网关已在运行，请按你的部署方式**重启或热加载**。

## Telegram 通道

### 多账户配置

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN_1",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        },
        "work": {
          "name": "Work Bot",
          "botToken": "BOT_TOKEN_2",
          "dmPolicy": "disabled",
          "groupPolicy": "allowlist",
          "groups": {
            "-1001234567890": {
              "requireMention": true,
              "systemPrompt": "You are a work assistant"
            }
          }
        }
      }
    }
  }
}
```

### 访问控制策略

**DM 策略** (`dmPolicy`):
- `pairing` - 需要与用户配对
- `allowlist` - 仅允许指定用户
- `open` - 允许所有用户
- `disabled` - 禁用 DM

**群组策略** (`groupPolicy`):
- `open` - 允许所有群组
- `allowlist` - 仅允许指定群组
- `disabled` - 禁用群组

### 流式配置

**流式模式** (`streamMode`):

| 模式 | 说明 |
|------|------|
| `off` | 不流式，一次性发送完整消息 |
| `partial` | 流式 AI 响应，工具显示进度 |
| `block` | 完整流式，包含所有中间更新 |

### 获取 Bot Token

1. 打开 Telegram，搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建新机器人
3. 按提示设置名称和用户名
4. 复制生成的 token

### 配置字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 启用通道 |
| `accounts` | object | 多账户配置 |
| `accounts.<id>.botToken` | string | Bot Token |
| `accounts.<id>.dmPolicy` | string | DM 访问策略 |
| `accounts.<id>.groupPolicy` | string | 群组访问策略 |
| `accounts.<id>.allowFrom` | array | 允许的用户 ID |
| `accounts.<id>.streamMode` | string | 流式模式 |
| `apiRoot` | string | 自定义 Telegram API 端点 |
| `debug` | boolean | 启用调试日志 |

### 语音消息 (STT/TTS)

配置语音消息支持：

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "paraformer-v1"
    }
  },
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "auto",
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "tts-1",
      "voice": "alloy"
    }
  }
}
```

查看 [语音文档](/zh/voice) 了解详情。

### 反向代理配置

受限网络环境：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "YOUR_BOT_TOKEN",
          "apiRoot": "https://your-proxy-domain.com"
        }
      }
    }
  }
}
```

启动时自动验证连接。

### 使用限制

- **仅支持群组和私聊**: 不支持频道（广播）
- **轮询模式**: 使用长轮询，约 1-2 秒延迟
- **语音消息**: STT 限制 60 秒
- **TTS 文本**: 限制 4000 字符

## 实现说明（开发者）

Telegram 通道以 **pnpm 工作区包** 形式位于 `extensions/telegram`（`@xopcai/xopcbot-extension-telegram`）。核心在 `src/channels/plugins/bundled.ts` 中注册该插件。为保持从核心代码导入路径稳定，`src/channels/telegram/index.ts` 会从该包再导出插件及相关类型。微信通道同理（`extensions/weixin`，私有工作区包）。通道采用 **`ChannelPlugin`** 模型（见 `src/channels/plugin-types.ts`），不再使用旧的 `telegramExtension` API。

---

## 网页（Web UI）通道

Web UI 由网关提供静态资源（`web/` 的 Vite 构建产物，与网关静态根目录一并发布）。

### 启动 Gateway

```bash
xopcbot gateway --port 18790
```

### 访问

在浏览器中打开 `http://localhost:18790`（或你配置的监听地址）。

### 功能

- ✅ 通过网关聊天（REST；代理回复在 `/api/agent` 上以 **SSE** 流式输出）
- ✅ 会话管理（`#/sessions`、侧栏任务列表）
- ✅ **IM 频道** 页 `#/channels`，配置 Telegram 与微信（见上文）
- ✅ 其它设置（模型、网关 Token、语音等）
- ✅ 日志查看
- ✅ Cron 任务管理

### 侧栏：按通道筛选会话

侧栏会话列表支持 **网页** / **Telegram** / **微信**：

- **网页** — 在 `GET /api/sessions` 结果上按会话 key 做客户端筛选，仅显示网页会话。
- **Telegram** / **微信** — 使用 `GET /api/sessions?channel=telegram` 或 `channel=weixin`，与 `SessionMetadata.sourceChannel` 一致。

---

## 其它通道类型（扩展）

部分部署会通过扩展增加飞书/钉钉/Discord 等通道，可能在 `channels.<id>` 中增加字段并由运行时加载；请参阅对应扩展说明及 `src/channels/plugins/bundled.ts`、生成的 bundled 插件列表。**控制台 IM 频道** 页目前只提供 **Telegram** 与 **微信** 的产品化配置入口。

---

## 消息格式

### 入站消息

```typescript
{
  channel: 'telegram',
  sender_id: '123456789',
  chat_id: '987654321',
  content: 'Hello, bot!',
  media?: string[],
  metadata?: Record<string, unknown>
}
```

### 出站消息

```typescript
{
  channel: 'telegram',
  chat_id: '987654321',
  content: 'Hello, user!',
  accountId?: string
}
```

---

## 发送消息

### 通过 CLI

```bash
# 发送消息到 Telegram
xopcbot agent -m "Hello from CLI"
```

### 通过 Gateway API

```bash
curl -X POST http://localhost:18790/api/message \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "telegram",
    "chat_id": "123456789",
    "content": "Hello via API!",
    "accountId": "personal"
  }'
```

### 通过扩展 Hook

```typescript
api.registerHook('message_sending', async (event, ctx) => {
  // 拦截或修改消息
  return { content: event.content };
});
```

---

## 最佳实践

1. **设置白名单**: 生产环境应设置 `allowFrom` 限制用户
2. **使用多账户**: 分离个人和工作机器人
3. **配置流式模式**: 使用 `partial` 获得平衡的 UX
4. **启用日志**: 通过日志监控通道状态
5. **错误处理**: 通道故障自动重试
6. **资源清理**: 服务停止时正确关闭连接

---

## 故障排除

### 未收到消息

1. 检查 token 是否正确
2. 确认 `enabled` 为 `true`
3. 检查网络连接
4. 与 BotFather 验证机器人状态

### @提及不工作

1. 检查群组设置中的机器人用户名
2. 验证 `requireMention` 配置
3. 确保机器人有群组权限

### 流式未显示

1. 检查 `streamMode` 是否为 `partial` 或 `block`
2. 验证通道支持流式（仅 Telegram）
3. 检查日志中的 DraftStream 错误

### 语音消息不工作

1. 确认 STT/TTS 配置
2. 检查 API 密钥是否有效
3. 验证音频长度 < 60 秒
4. 检查日志中的 STT/TTS 错误
