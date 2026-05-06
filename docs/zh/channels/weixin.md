# 微信（Weixin）通道

## 网关控制台 — 即时通讯

网关运行时可使用 React 控制台中的 **即时通讯** 专页：

- **路由：** `#/channels`（侧栏 **即时通讯**）。
- **前提：** 已在设置中保存 **网关访问令牌**，以便调用需鉴权的 API。
- **当前产品界面：** 可配置 **微信**、**Telegram**、**飞书** 与 **钉钉**（含移除/禁用等卡片操作）。

### 微信登录

- 弹窗内 **扫码登录**，与网关交互：
  - `POST /api/channels/weixin/login/start` — 创建会话并返回二维码载荷。
  - `GET /api/channels/weixin/login/:sessionKey` — 轮询直至完成；凭据写入 **运行网关的本机**。
- 登录成功后从 `GET /api/config` 刷新表单。可选 **高级选项**（白名单、`dmPolicy`、`streamMode`、多账号 JSON 等）在同一弹窗内编辑并通过 **保存** 写入配置。
- 也可在网关主机用 CLI 登录，例如：`pnpm run dev -- channels login --channel weixin`（具体以本机安装与 `--help` 为准）。

## 最小配置示例

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

- **`dmPolicy`**：`pairing` | `allowlist` | `open` | `disabled`
- **`allowFrom`**：在需要白名单式私聊策略时，填写允许的 wxid / openid。
- **`accounts`**：可选，按账号覆盖（名称、`cdnBaseUrl`、`routeTag`、策略等）。

修改凭据后若网关已在运行，请按你的部署方式**重启或热加载**。

