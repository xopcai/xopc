# 钉钉（DingTalk）通道

钉钉为 **内置打包** 的通道插件（`extensions/dingtalk`），配置位于 **`channels.dingtalk`**。

接入使用 **钉钉 Stream**（`dingtalk-stream`）接收事件，出站由通道适配器发消息。该通道在元数据上标记为 **`blockStreaming: true`**（通道层不做流式分片展示），机器人仍可收消息并一次性回复完整内容。

## 网关控制台 — 即时通讯

网关运行时，可在 React 控制台 **即时通讯** 页面（`#/channels`）与微信、Telegram、飞书一起配置钉钉。

- **前提：** 在设置中保存 **网关访问令牌**，以便调用需鉴权的 API。
- **配置 / 编辑** 会打开 **扫码注册** 弹窗，并自动发起设备授权流程。扫码成功后，网关会把 **`clientId`**、**`clientSecret`** 合并写入本机 `xopc.json` 的 `channels.dingtalk`（保留原有策略等字段），并刷新内存中的配置。
- 同一弹窗底部的 **高级选项** 可编辑私聊/群策略、白名单、`endpoint`、历史条数、多账号 JSON、手动填写 Client ID / Secret 等，通过 **保存** 写入。

### 设置相关 API（需登录）

- `POST /api/channels/dingtalk/setup/start` — 开始注册，返回 `sessionKey` 与 `qrUrl`（扫码链接）。
- `GET /api/channels/dingtalk/setup/:sessionKey` — 轮询会话状态；成功时由服务端落盘凭据（逻辑同上）。

### CLI（在运行网关的机器上）

也可在主机用命令行完成扫码或手输凭据（与适配器相同流程）：

```bash
xopc channels login --channel dingtalk
```

若支持交互式引导（如 `xopc channels onboard`），可能会包含钉钉配置步骤。

### 可选环境变量

设备注册客户端使用（一般无需修改）：

- `DINGTALK_REGISTRATION_BASE_URL` — 注册接口根地址（默认 `https://oapi.dingtalk.com`）。
- `DINGTALK_REGISTRATION_SOURCE` — 注册来源标识（默认 `DING_XOPC`）。

## 最小配置示例

```json
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "dingxxxxxxxx",
      "clientSecret": "xxx",

      "dmPolicy": "pairing",
      "groupPolicy": "open",
      "allowFrom": [],
      "groupAllowFrom": [],
      "requireMention": false,

      "historyLimit": 50,
      "textChunkLimit": 4000
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用该通道配置块。 |
| `clientId` / `clientSecret` | 来自钉钉开放平台（或扫码设备注册）。 |
| `dmPolicy` | `pairing` \| `allowlist` \| `open` \| `disabled`（CLI 合并新配置时默认私聊为 `pairing`）。 |
| `groupPolicy` | `open` \| `allowlist` \| `disabled`。 |
| `allowFrom` / `groupAllowFrom` | 使用白名单类策略时允许的标识（字符串或数字 ID）。 |
| `requireMention` | 群内是否需要 `@` 机器人才处理消息。 |
| `endpoint` | 可选，自定义 API 入口（高级部署）。 |
| `debug` | 开启后额外日志。 |

**`dmPolicy: pairing`**：未允许的私聊用户会在单聊里收到 **配对码**；合并规则与 Telegram / 飞书 一致（配置 **`allowFrom`** + **`~/.xopc/credentials/xopc-dingtalk-<账号>-allowFrom.json`**），详见 [DM 私聊配对](./index.md#dm-pairing)。在网关所在机执行 **`xopc channels pairing approve --channel dingtalk [--account <账号>] <配对码>`**。

**网关 / CLI 扫码注册** 不会从钉钉接口带回扫码人的 **用户 id**，因此 **不会自动写入 `allowFrom`**：请在 **`channels.dingtalk.allowFrom`** 中预置核心用户 staffId，或配对批准一次，以便配完凭据后立刻可用。

## 多账号（`accounts`）

使用 `channels.dingtalk.accounts.<id>` 覆盖单账号的 `clientId`、`clientSecret`、策略、条数限制、`endpoint` 等。多账号时请设置 `defaultAccount`。

## 能力范围（摘要）

- **会话：** 单聊与群聊。
- **当前通道未作为一等能力开放：** 原生表情反应、话题、媒体卡片、投票等（见插件 `capabilities` 元数据）。

## 故障排查

- **扫码 / start 失败：** 确认网关机器能访问钉钉注册接口；若走代理或专有云，检查 `DINGTALK_REGISTRATION_BASE_URL`。
- **改配置后收不到消息：** 重启或重载网关，以便 Stream 订阅使用新凭据。
