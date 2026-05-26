# 远程访问

从其他设备（手机、笔记本或远程服务器）连接 Gateway，同时尽量少暴露攻击面。

**设置界面：** 网关控制台 → **设置 → 远程访问**（`#/settings/remote-access`）。

同一时间只应启用 **一种** 对外暴露模式（Tailscale Serve **或** 公网 FRP 隧道）。若两者同时开启，**概览** Tab 会提示配置冲突。

---

## 如何选择方式

| 场景 | 方式 | 设置 Tab |
|------|------|----------|
| Tailscale tailnet 内的个人设备 | **Tailscale Serve**（推荐） | Tailscale |
| 移动 App / 从公网访问 HTTPS | **公网隧道**（FRP） | 公网访问 |
| 本机 CLI/TUI，可 SSH 到主机 | **SSH 隧道** | SSH 隧道 |
| 同一 Wi‑Fi 下的手机 | **局域网绑定** | 局域网 → Gateway 设置 |
| 企业 SSO 前置网关 | **反向代理** | 概览（见下文） |

整体架构见 [网络说明](../network.md)。

---

## 概览 Tab

概览页显示 **本机 Gateway** 上各方式的激活状态：

- **Tailscale Serve** — tailnet HTTPS 状态
- **公网隧道** — FRP 连接状态
- **SSH 隧道** — CLI 端口转发命令
- **局域网** — 跳转至 Gateway 绑定设置
- **反向代理** — Gateway 位于 nginx、Caddy 等前置代理时的说明

点击方式卡片进入对应 Tab。切换方式前，请先解决 Tailscale 与公网隧道同时启用的问题。

---

## Tailscale Serve {#tailscale-serve}

适合所有客户端都在 **Tailscale tailnet** 内的场景。Gateway 进程仍监听 `127.0.0.1`，由 Tailscale 在 MagicDNS 主机名上发布 HTTPS。

### 在设置界面中

1. 在 Gateway 主机安装 [Tailscale](https://tailscale.com/download) 并登录 tailnet。
2. 打开 **远程访问 → Tailscale**。
3. 点击 **启用 Serve**。
4. 复制 `https://<主机名>/` 地址，在 tailnet 内任意设备打开。
5. 使用 **Gateway Bearer token** 登录网页控制台（所有 `/api/*` 仍需要 token）。

### 配置示例

```json5
{
  gateway: {
    bind: "loopback",
    port: 18790,
    auth: { mode: "token", token: "…" },
    tailscale: { mode: "serve", resetOnExit: true },
  },
}
```

CLI 一次性启用：

```bash
xopc gateway --tailscale serve --tailscale-reset-on-exit
xopc tailscale status
```

### 说明

- **Serve** 要求 `gateway.bind=loopback`。
- **Funnel**（经 Tailscale 暴露到公网）风险较高，且需要密码认证 — 见 [Tailscale](../gateway/tailscale.md)。
- Tailscale 暴露与 `tunnel.autoStart` **不能同时启用**。

更多细节：[Tailscale Serve / Funnel](../gateway/tailscale.md)（英文）。

---

## 公网访问（FRP 隧道）{#public-tunnel}

需要 **公网 HTTPS 地址** 时使用 — 例如移动 App 配对或从 tailnet 外访问 Gateway。

流量经 **frp.xopc.ai** 代理。**风险较高**：持有公网 URL 或配对 QR 的人若获得 Bearer token，可能访问你的 Gateway。

### 在设置界面中

1. 打开 **远程访问 → 公网访问**。
2. 阅读安全说明并点击 **开启远程访问**（首次需确认风险）。
3. 等待公网 URL 分配（首次开启可能需 1–3 分钟以完成 HTTPS）。
4. 在控制卡片下方的 **移动 App 配对** 区域扫码（或复制配对链接）。
5. 不需要远程访问时请及时 **断开** 隧道。

### Broker 注册密钥

连接生产 broker 需要 **注册密钥**（不是 Gateway token）：

| 来源 | 优先级 |
|------|--------|
| 环境变量 `XOPC_TUNNEL_REGISTRATION_SECRET` | 1（最高） |
| `xopc.json` 中 `tunnel.registrationSecret` | 2 |
| 开发默认值 | 3（仅非生产 broker） |

在 **公网访问** Tab 的 **高级设置** 中填写，或：

```bash
xopc tunnel secret set
```

### 选项

- **启动时自动开启** — Gateway 每次启动时自动建立隧道（需有效 consent 且曾成功开启过一次）。
- **释放公网地址** — 在 broker 上注销子域名；下次开启会获得新 URL。

### 配置字段（摘要）

| 字段 | 含义 |
|------|------|
| `tunnel.enabled` | 用户已开启远程访问 |
| `tunnel.autoStart` | Gateway 监听时自动启动隧道 |
| `tunnel.consent` | 接受安全说明的记录 |
| `tunnel.registrationSecret` | Broker 注册密钥 |

完整安全模型、API 与 CLI：[FRP 隧道安全](../tunnel-security.md)（英文）。

---

## SSH 隧道（CLI）{#ssh-tunnel}

可 SSH 到主机、但不需要公网 URL 时，打开 **远程访问 → SSH 隧道** 复制命令，或直接运行：

```bash
xopc gateway ssh-tunnel --target user@your-host --local-port 18790 --remote-port 18790
# 等价于：
ssh -N -L 18790:127.0.0.1:18790 user@your-host
```

然后在本地打开 `http://127.0.0.1:18790`。

### CLI 持久远程模式

```json5
{
  gateway: {
    mode: "remote",
    remote: {
      url: "http://127.0.0.1:18790",
      token: "your-token",
      transport: "ssh",
      sshTarget: "user@gateway-host",
    },
  },
}
```

`gateway.mode=remote` 时 CLI/TUI/MCP 使用 `gateway.remote`。可用 `XOPC_GATEWAY_URL` 覆盖。

更多：[远程访问（SSH + CLI）](../gateway/remote.md)（英文）。

---

## 同一网络（局域网）{#lan}

**同一 Wi‑Fi** 内访问、不暴露公网时，打开 **远程访问 → 局域网**，然后：

1. 打开 **设置 → Gateway**。
2. 将 **绑定地址** 设为局域网 IP 或 `0.0.0.0`（配合 token 认证与防火墙）。
3. 使用 `http://<局域网-ip>:<端口>` 连接。

Gateway 仍绑定 loopback 时，公网访问 Tab 可为移动配对推荐局域网地址。

---

## 反向代理与企业入口 {#advanced}

在 nginx、Caddy 或 Pomerium 终止 TLS 并做用户认证时：

- 保持 `gateway.bind=loopback`。
- 配置 [可信代理认证](../gateway/trusted-proxy.md)（英文）。
- 禁止从公网直接访问 Gateway 端口。

---

## 故障排查

| 现象 | 检查 |
|------|------|
| 概览显示配置冲突 | 关闭 Tailscale Serve 或停止公网隧道 |
| 公网隧道无法启动 | 是否设置注册密钥？是否已确认 consent？查看日志 `TunnelAudit` |
| 移动 QR 提示 localhost | 启用局域网绑定或开启公网隧道 |
| Tailscale 启用失败 | 本机是否已安装并登录 Tailscale？`gateway.bind=loopback`？ |
| CLI 无法连接远程 Gateway | `gateway.mode=remote`、SSH 隧道、`gateway.remote` 中的 token |

---

## 相关文档

- [网络说明](../network.md)（英文）
- [Tailscale Serve / Funnel](../gateway/tailscale.md)（英文）
- [FRP 隧道安全](../tunnel-security.md)（英文）
- [SSH 与 CLI 远程模式](../gateway/remote.md)（英文）
- [可信代理认证](../gateway/trusted-proxy.md)（英文）
- [Gateway 配置](./gateway.md)
- [配置参考](./configuration.md)
