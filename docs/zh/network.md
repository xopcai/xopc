# 网络访问

## 出站 HTTP 代理

打开 **设置 → 本机服务 → 网络 → 网络出口代理**，配置 Gateway 的 HTTP 请求，包括使用 Node fetch 的模型和 OAuth 请求。保存后重启 Gateway 生效。

- **跟随启动环境**（默认）：使用 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`，小写变量优先。
- **自定义代理**：HTTP 和 HTTPS 请求都使用指定的 HTTP(S) 代理，覆盖启动环境中的代理变量。
- **直接连接**：忽略启动环境中的 HTTP 代理变量。

```json
{
  "gateway": {
    "outboundProxy": {
      "mode": "custom",
      "url": "http://127.0.0.1:7897",
      "noProxy": ".internal.example,192.168.1.10"
    }
  }
}
```

`localhost`、`127.0.0.1` 和 `::1` 始终直连。绕过地址支持逗号分隔的主机名或域名后缀；`*` 表示全部直连。代理地址仅支持不含账号密码、路径、查询参数或片段的 HTTP(S) 地址，暂不支持 SOCKS。本设置不配置外部子进程或独立管理的 WebSocket 客户端。
