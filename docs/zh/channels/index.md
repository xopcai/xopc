# 频道

xopc 可将助手接到 **Telegram**、**微信**、**飞书（Feishu / Lark）** 以及 **网关自带的网页对话**。若还装了第三方扩展，还可能出现其它 **`channels.<id>`** 配置块。

所有频道相关设置都在 **`~/.xopc/xopc.json`**（或由 **`XOPC_CONFIG`** 指向的文件）的 **`channels`** 下。

## 概览

| 频道 | 状态 | 功能 |
|------|------|------|
| **Telegram** | ✅ | Bot Token 或多账号 JSON、流式、语音、文档 |
| **微信（Weixin）** | ✅ | 在网关所在机扫码登录、私聊策略、可选按账号 JSON |
| **飞书（Feishu / Lark）** | ✅ | Socket Mode / Webhook、卡片、文档/知识库/云盘工具（可选开）；控制台支持扫码创建应用 |
| **网页（Web UI）** | ✅ | 网关控制台里内嵌聊天，与其它客户端共用 HTTP API |

## 各频道文档

- [Telegram](./telegram.md)
- [微信（Weixin）](./weixin.md)
- [飞书（Feishu / Lark）](./feishu.md)
- [网页（Web UI）](./webui.md)

## 扩展与频道

其它频道若由扩展提供，同样使用 **`channels.<id>`**，字段以扩展文档为准。

按需配置 **`channels.telegram`**、**`channels.weixin`**、**`channels.feishu`** 等，保存后由网关加载。若要 **禁用** 某个扩展 id，写入 **`extensions.disabled`**。

扩展与 CLI 的加载关系见 [扩展系统 — 何时加载扩展](../extensions.md#何时加载扩展)。

## DM 私聊配对 {#dm-pairing}

**Telegram、飞书、微信** 在 **`dmPolicy` 为 `pairing`** 时，私聊是否放行由 **合并后的允许列表** 决定：

1. 配置文件 **`xopc.json`** 里的 **`allowFrom`**（Telegram：`channels.telegram.accounts.<账号>.allowFrom`；飞书/微信按各自文档使用通道或账号 allowlist）；
2. 磁盘上 **已配对用户** 的 JSON 凭证（与配置在运行时合并）。

若发送方不在允许列表中，机器人会回复 **一次性配对码**，并提示管理员在本机执行：

```bash
xopc channels pairing approve --channel <telegram|feishu|weixin> [--account <id>] <配对码>
```

命令说明见 **[CLI — channels](../cli.md#channels)**。请在 **存有凭证文件的主机**（一般为网关所在机）上执行 `approve`。

### 网关控制台（Web UI）

无需 CLI，可在网关控制台审批、撤销并查看待配对请求：

1. 打开 **设置 → IM 频道**（hash 路由 `#/settings/channels`）。
2. 完成频道配置（Telegram Token、微信扫码登录或飞书应用凭证），并将 **`dmPolicy`** 设为 **`pairing`**。
3. 用户向 bot 发私聊后，待审批项会出现在 Telegram 设置对话框，或微信 / 飞书的 **Advanced** 区域。
4. 输入 **8 位配对码** 批准，或在确认 user id 对应真实发消息用户后使用 **快速批准**。
5. Hub 卡片显示待审批角标；新配对或重复 DM 会通过 SSE 自动刷新列表。

REST 接口（需 gateway bearer token）：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/channels/pairing?channel=&account=` | 待审批列表 + 已配对 allowFrom（配置 + 凭证） |
| `GET` | `/api/channels/pairing/summary` | 各频道 pending / stale / 达上限统计 |
| `POST` | `/api/channels/pairing/approve` | 按配对码批准 |
| `POST` | `/api/channels/pairing/approve-sender` | 按 sender id 快速批准 |
| `DELETE` | `/api/channels/pairing/paired` | 撤销凭证 allowFrom 条目 |
| `DELETE` | `/api/channels/pairing/pending` | 忽略待审批请求（不批准） |

Summary 与 `xopc doctor` 配对检查仅统计 **已启用** 且 effective **`dmPolicy` 为 `pairing`** 的频道（含账号级覆盖）。

**凭证文件目录**：未设置 **`XOPC_CREDENTIALS_DIR`** 时，Telegram / 飞书 使用 **`~/.xopc/credentials/`**（若设置了该环境变量则为其值）。

| 通道 | 允许名单文件 | 待审批配对 |
|------|----------------|------------|
| Telegram | `xopc-telegram-<account>-allowFrom.json` | `xopc-telegram-<account>-pairing.json` |
| 飞书 | `xopc-feishu-<account>-allowFrom.json` | `xopc-feishu-<account>-pairing.json` |

**微信** 使用 **`~/.xopc/weixin/credentials/`**（同样可被 **`XOPC_CREDENTIALS_DIR`** 覆盖为其它根目录）：`xopc-weixin-<account>-allowFrom.json` 与 `xopc-weixin-<account>-pairing.json`。

**`allowlist`**：未命中列表则直接丢弃，**不会**发配对码。**`open`**：私聊不做限制。**`disabled`**：不接受私聊。

**飞书网关控制台扫码创建应用：** 会把扫码人的 **`open_id`** 写入 **`channels.feishu.allowFrom`**，在默认 **`pairing`** 下该用户可立刻私聊。

## 与网关启动顺序的关系

使用 **`xopc gateway`** 时，Telegram / 微信 / 飞书 等外连通道可能在 **HTTP 监听成功之后** 才执行 **`start()`**，减轻错误 `apiRoot` 或外网不通时拖住整个网关控制台的情况。说明见 [网关 — 频道启动与 HTTP 监听顺序](../gateway.md#频道启动与-http-监听顺序) 与 [配置 — 频道连接延后](../configuration.md#频道连接延后）。
