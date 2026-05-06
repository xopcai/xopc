# 飞书（Feishu / Lark）通道

飞书配置位于 **`channels.feishu`**。该通道支持两种传输模式：

- **`websocket`**（默认）：飞书 Socket Mode。
- **`webhook`**：本地 HTTP server 接收飞书事件（需要 webhook 密钥）。

## 网关控制台 — 即时通讯

在网关运行且已在设置中保存 **网关访问令牌** 时，可在 **`#/channels`**（侧栏 **即时通讯**）中配置飞书。

- **配置 / 编辑** 会打开 **扫码创建应用** 弹窗，并**默认立即**为 **国内（飞书）** 租户发起流程。
- 二维码下方的 **胶囊切换** 可在 **国内（飞书）** 与 **国际（Lark）** 之间切换；切换后会重新生成二维码并发起新的注册会话。
- 扫码成功后，网关会把 **`appId`**、**`appSecret`**、**`domain`** 合并写入 `channels.feishu`（保留已有字段，如 `connectionMode`；新装默认 **`websocket`**）。
- Webhook 密钥、工具开关、策略、多账号 JSON 等完整表单项在弹窗的 **高级选项** 中，通过 **保存** 写入。

### 设置相关 API（需登录）

- `POST /api/channels/feishu/setup/start` — 可选 JSON：`{ "domain": "feishu" | "lark" }`（缺省或非 `lark` 时按国内 `feishu`）。返回 `sessionKey` 与 `qrUrl`。
- `GET /api/channels/feishu/setup/:sessionKey` — 轮询直至结束；成功时由服务端按上文规则落盘凭据。

若不想使用扫码创建，仍可在开放平台中完全手动创建应用并按下文配置（与此前文档一致）。

## 创建并配置飞书应用

在飞书开放平台（或 Lark Developer）中：

1. 创建一个 **企业自建应用**。
2. 为应用添加 **机器人（Bot）** 能力。
3. 在应用的 **凭证 / Credentials** 页面获取 **App ID** / **App Secret**。
4. 配置应用的 **权限（Scopes）**（见下文），并按租户要求提交审批/发布。
5. 配置 **事件订阅**：
   - 打开事件订阅开关。
   - 订阅所需事件类型（见下文）。
   - **Socket Mode**：启用平台提供的 **长连接 / WebSocket**（不同后台的文案可能略有差异）。
   - **Webhook 模式**：将 **Request URL** 配置为 `webhookHost` + `webhookPort` + `webhookPath` 对应的地址，并把 **Verification Token** 与 **Encrypt Key** 填入 `channels.feishu`。

## 权限（scopes）— 可复制 JSON

飞书权限使用 scopes 管控。你可以先按“只收发消息”的最小权限跑通，再按需开启 xopc 的飞书工具（`channels.feishu.tools.*`）并补齐对应 scopes。

### 最小权限（消息 + 卡片 + 基础身份）

```json
{
  "scopes": ["im:message", "im:chat", "contact:user.base:readonly"]
}
```

### 推荐权限（含 doc/wiki/drive；perm/bitable 按需开启）

```json
{
  "scopes": [
    "im:message",
    "im:chat",
    "contact:user.base:readonly",

    "docx:document",
    "docx:document:readonly",
    "docx:document.block:convert",

    "drive:drive",
    "drive:drive:readonly",

    "wiki:wiki",
    "wiki:wiki:readonly",

    "drive:permission",

    "bitable:app",
    "bitable:app:readonly",
    "bitable:table",
    "bitable:table:readonly",
    "bitable:record",
    "bitable:record:readonly"
  ]
}
```

说明：

- 若租户策略要求“只读/读写”二选一，请选择最小可用集合。
- 不用的工具（例如 `feishu_perm`）建议不要给对应 scope。
- scopes 变更后通常需要管理员审批/重新发布后才会生效。

## 事件订阅（订阅哪些事件）

至少订阅：

- `im.message.receive_v1`（入站消息）
- `card.action.trigger`（交互卡片回调：按钮/输入；流式卡片与部分操作依赖）

建议订阅（启用对应能力时）：

- `im.message.reaction.created_v1` / `im.message.reaction.deleted_v1`（表情反应相关工作流）
- `drive.notice.comment_add_v1`（云盘/文档评论通知）
- `im.chat.member.bot.added_v1` / `im.chat.member.bot.deleted_v1`（机器人进群/退群；可选）
- `application.bot.menu_v6`（机器人菜单；可选）

## 最小配置（Socket Mode / websocket）

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "domain": "feishu",
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "connectionMode": "websocket",

      "dmPolicy": "open",
      "groupPolicy": "open",
      "allowFrom": [],
      "groupAllowFrom": [],
      "requireMention": false,

      "renderMode": "card",
      "reactionNotifications": "own",
      "actions": { "reactions": true },

      "streaming": false,
      "historyLimit": 50,
      "textChunkLimit": 4000,

      "tools": { "doc": true, "wiki": true, "drive": true, "perm": true, "bitable": true, "scopes": true }
    }
  }
}
```

## Webhook 模式（需要 `encryptKey` + `verificationToken`）

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "domain": "feishu",
      "appId": "cli_xxx",
      "appSecret": "xxx",

      "connectionMode": "webhook",
      "verificationToken": "xxx",
      "encryptKey": "xxx",
      "webhookHost": "127.0.0.1",
      "webhookPort": 3000,
      "webhookPath": "/feishu/events"
    }
  }
}
```

## 多账号（`accounts`）

可用 `channels.feishu.accounts.<id>` 覆盖每个账号的设置（包括 `connectionMode` 与 webhook 密钥）。

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "domain": "feishu",
      "defaultAccount": "im-bot",

      "appId": "cli_shared_xxx",
      "appSecret": "shared_secret_xxx",
      "connectionMode": "websocket",

      "accounts": {
        "im-bot": { "enabled": true, "connectionMode": "websocket" },
        "webhook-bot": {
          "enabled": true,
          "connectionMode": "webhook",
          "verificationToken": "xxx",
          "encryptKey": "xxx",
          "webhookHost": "127.0.0.1",
          "webhookPort": 3001,
          "webhookPath": "/feishu/events-webhook"
        }
      }
    }
  }
}
```

## 故障排查

- **报错：`Feishu webhook mode requires encryptKey`**：该账号解析后的有效配置为 `connectionMode=webhook`，但缺少 `encryptKey`。请设置 `encryptKey`（顶层 `channels.feishu.encryptKey` 或 `channels.feishu.accounts.<id>.encryptKey`），或切回 `connectionMode: "websocket"`。

