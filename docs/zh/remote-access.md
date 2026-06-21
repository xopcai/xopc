# 远程访问

从其他设备（手机、笔记本或远程服务器）连接 Gateway，同时尽量少暴露攻击面。

**设置界面：** 网关控制台 → **设置 → 远程访问**（`#/settings/remote-access`）。

iOS/Android 使用 **[xopc-app](https://github.com/xopcai/xopc-app)** 连接已运行的 gateway。移动端专门路径见 [移动端 app](./mobile-app.md)。

同一时间只应启用 **一种** 对外暴露模式（Tailscale Serve **或** 公网 FRP 隧道）。若两者同时开启，**概览** Tab 会提示配置冲突。

---

## 如何选择方式

| 场景 | 方式 | 设置 Tab |
|------|------|----------|
| Tailscale tailnet 内的个人设备 | **Tailscale Serve**（推荐） | Tailscale |
| 移动 App / 从公网访问 HTTPS | **公网隧道**（FRP） | 公网访问 |
| 自部署 HTTPS，使用自己的域名 | **反向代理**（Caddy / nginx / Cloudflare Tunnel） | 反向代理 |
| 本机 CLI/TUI，可 SSH 到主机 | **SSH 隧道** | SSH 隧道 |
| 同一 Wi‑Fi 下的手机 | **局域网绑定** | 局域网 → Gateway 设置 |
| 企业 SSO 前置网关 | **可信代理认证**（高级） | 见下文「高级」章节 |

整体架构见 [网络说明](../network.md)。

---

## 概览 Tab

概览页显示 **本机 Gateway** 上各方式的激活状态：

- **Tailscale Serve** — tailnet HTTPS 状态
- **公网隧道** — FRP 连接状态
- **反向代理** — 已配置的 `gateway.publicUrl`（自部署 HTTPS）
- **SSH 隧道** — CLI 端口转发命令
- **局域网** — 跳转至 Gateway 绑定设置

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

需要 **公网 HTTPS 地址** 时使用 — 例如 [xopc-app](https://github.com/xopcai/xopc-app) 配对或从 tailnet 外访问 Gateway。

流量经 **frp.xopc.ai** 代理。**风险较高**：持有公网 URL 或配对 QR 的人若获得 Bearer token，可能访问你的 Gateway。

### 在设置界面中

1. 打开 **远程访问 → 公网访问**。
2. 阅读安全说明并点击 **开启远程访问**（首次需确认风险）。
3. 等待公网 URL 分配（首次开启可能需 1–3 分钟以完成 HTTPS）。
4. 在控制卡片下方的 **移动 App 配对** 区域用 [xopc-app](./mobile-app.md) 扫码（或复制配对链接）。
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

## 反向代理（自部署 HTTPS）{#reverse-proxy}

用 **你自己部署的 HTTPS 反向代理**（Caddy、nginx、Cloudflare Tunnel 等）将 Gateway 暴露在自定义域名下，例如 `https://gateway.example.com`。反向代理负责 TLS 终止并转发到 loopback 上的 Gateway；[xopc-app](./mobile-app.md) 通过这个公网 URL 完成配对。

这与「可信代理认证」（见下文「[高级](#advanced)」）**不同**：这里反代只承担 TLS / 域名职责，**Gateway 仍用自己的 Bearer token 鉴权**，不需要 SSO。

### 适用场景

- 你已经拥有域名 + TLS 证书（Let's Encrypt、Cloudflare、商业 CA）。
- 想用 `https://xopc.yourdomain.com` 这样易记的地址，而不是 `*.frp.xopc.ai`。
- 需要在 Gateway 前加 IP 白名单 / WAF。
- 处于 CGNAT 环境，使用 Cloudflare Tunnel / Tailscale Funnel 作为反代。

### 在设置界面中

1. 打开 **远程访问 → 反向代理**。
2. 如果你已经通过反代访问当前控制台（地址栏显示 `https://gateway.example.com`），该 Tab 会 **自动识别** URL 并立即展示配对 QR，**无需先保存**。
3. 点击 **测试** 调用 `/api/tunnel/pair/ping` 验证 TLS + DNS + 连通性。
4. 点击 **保存为默认** 持久化为 `gateway.publicUrl`，其他客户端/重启后共用同一地址。
5. 在 [xopc-app](https://github.com/xopcai/xopc-app) 中扫码。

移动 App 会把该 URL 存为主 `baseUrl`，若可达会回退到 LAN / FRP。

### 配置示例

```json5
{
  gateway: {
    bind: "loopback",                       // 反代经 localhost 连接
    port: 18790,
    auth: { mode: "token", token: "…" },
    publicUrl: "https://gateway.example.com",  // 新增
  },
}
```

- 公网域名必须使用 **https**；`http` 仅允许 RFC1918 / `.local`。
- 不能包含路径 / query / userinfo。结尾 `/` 会被自动去除。
- 已配置的 URL 会自动加入 CORS / CSRF 白名单。
- 反代与 FRP **可同时启用**：移动 App **优先使用反代**，FRP 作为 `connectUrls` 中的回退。

### 反向代理模板

**Caddy**（自动 Let's Encrypt）：

```caddy
gateway.example.com {
  reverse_proxy 127.0.0.1:18790 {
    flush_interval -1                     # SSE：禁用响应缓冲
    transport http { keepalive 90s }
  }
}
```

**nginx：**

```nginx
server {
  listen 443 ssl http2;
  server_name gateway.example.com;
  ssl_certificate     /etc/letsencrypt/live/gateway.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/gateway.example.com/privkey.pem;

  location / {
    proxy_pass         http://127.0.0.1:18790;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Forwarded-Proto https;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_buffering    off;               # SSE：禁用响应缓冲
    proxy_read_timeout 3600s;             # 长连接 SSE / WS
  }
}
```

### 部署要求

| 要求 | 原因 |
|---|---|
| **系统信任的 TLS 证书**（Let's Encrypt / 商业 CA） | 移动端会拒绝自签证书（iOS ATS、Android 默认安全配置）。**v1 不支持自签**。 |
| `proxy_buffering off`（nginx）/ `flush_interval -1`（Caddy） | SSE 流（`/api/events`、`/api/agent/stream`）必须立即 flush。 |
| Idle 超时足够长（≥ 60s，建议数小时） | 聊天与事件流是长连接。 |
| **不要** 剥离 `Authorization` 请求头 | Gateway 仍用自己的 Bearer token 鉴权。 |
| `/health` 与 `/api/tunnel/pair/ping` 必须可达 | 移动端 preflight + UI 上「测试」按钮依赖。 |

### 故障排查

| 现象 | 检查 |
|---|---|
| 移动端提示「反向代理无响应」 | 点击 **测试** 按钮。TLS 证书是否有效？DNS 解析？`/api/tunnel/pair/ping` 是否可达？ |
| 浏览器控制台报 CORS / 403 | 确认 TCP 连接来自 loopback（反代在同一台机器）**或** 把反代 IP 加入 `gateway.trustedProxies`。 |
| SSE 流几秒后中断 | 关闭反代响应缓冲。nginx：`proxy_buffering off`；Caddy：`flush_interval -1`。 |
| 配对成功但一分钟后断开 | 调大反代 idle 超时。 |
| QR 在本地能用、蜂窝网络不行 | 公网 DNS / 防火墙问题 — URL 必须能从外网解析并连接。 |

---

## 同一网络（局域网）{#lan}

**同一 Wi‑Fi** 内访问、不暴露公网时，打开 **远程访问 → 局域网**，然后：

1. 打开 **设置 → Gateway**。
2. 将 **绑定地址** 设为局域网 IP 或 `0.0.0.0`（配合 token 认证与防火墙）。
3. 使用 `http://<局域网-ip>:<端口>` 连接。

Gateway 仍绑定 loopback 时，公网访问 Tab 可为移动配对推荐局域网地址。

---

## 高级：可信代理认证 {#advanced}

适用于 **反向代理自己负责用户认证** 的场景（Pomerium、oauth2-proxy、企业 SSO 等），由 Gateway 信任请求头中的用户身份 — 与「[反向代理](#reverse-proxy)」Tab 不同，后者保留 Bearer token 鉴权：

- 保持 `gateway.bind=loopback`。
- 配置 [可信代理认证](../gateway/trusted-proxy.md)（英文）：`gateway.auth.mode = "trusted-proxy"`，配置 `trustedProxies` CIDR 与 `auth.trustedProxy.userHeader`。
- 禁止从公网直接访问 Gateway 端口。

移动 App 的配对流程 **不使用** 此模式（手机无法提供 SSO 身份）。

---

## 故障排查

| 现象 | 检查 |
|------|------|
| 概览显示配置冲突 | 关闭 Tailscale Serve 或停止公网隧道 |
| 公网隧道无法启动 | 是否设置注册密钥？是否已确认 consent？查看日志 `TunnelAudit` |
| 移动 QR 提示 localhost | 启用局域网绑定、开启公网隧道，或配置反向代理 |
| Tailscale 启用失败 | 本机是否已安装并登录 Tailscale？`gateway.bind=loopback`？ |
| CLI 无法连接远程 Gateway | `gateway.mode=remote`、SSH 隧道、`gateway.remote` 中的 token |
| 反向代理：「测试」按钮报 TLS 错 | 证书不可信（自签？）、SNI 不对，或证书过期 |
| 反向代理：SSE 流几秒中断 | 缺少 `proxy_buffering off`（nginx）或 `flush_interval -1`（Caddy） |

---

## 相关文档

- [网络说明](../network.md)（英文）
- [Tailscale Serve / Funnel](../gateway/tailscale.md)（英文）
- [FRP 隧道安全](../tunnel-security.md)（英文）
- [SSH 与 CLI 远程模式](../gateway/remote.md)（英文）
- [可信代理认证](../gateway/trusted-proxy.md)（英文）
- [Gateway 配置](./gateway.md)
- [配置参考](./configuration.md)
