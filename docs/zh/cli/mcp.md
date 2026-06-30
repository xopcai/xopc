# MCP CLI 与 API

XOPC 提供 **出站 bundle-MCP**（智能体调用外部 MCP 工具）和 **入站通道桥接**（`xopc mcp serve`，供 stdio MCP 客户端连接）。

配置、控制台操作、工具命名与生命周期详见主文档：[MCP](../mcp.md)。

---

## 配置速查

MCP 服务器写在 `~/.xopc/xopc.json` 的 `mcp.servers` 下：

```json
{
  "mcp": {
    "sessionIdleTtlMs": 600000,
    "servers": {
      "fetch": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-fetch"]
      },
      "remote": {
        "url": "https://example.com/mcp",
        "transport": "streamable-http",
        "headers": {
          "Authorization": "Bearer ${MCP_TOKEN}"
        },
        "connectionTimeoutMs": 30000
      }
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| `command` + `args` | stdio 子进程启动 MCP |
| `url` + `transport` | 远程 MCP：`sse` 或 `streamable-http` |
| `headers` / `env` | HTTP 头或 stdio 环境变量（支持 `${变量名}`；stdio 会过滤宿主环境） |
| `connectionTimeoutMs` | 连接 / 拉工具 / 调用超时（默认 **30 秒**） |
| `sessionIdleTtlMs` | 会话级运行时空闲回收（默认 **10 分钟**；`0` 表示不回收） |

扩展 `.mcp.json` 与用户配置合并（同名 id 以用户为准）。

---

## 关闭 MCP 工具

在所选 agent manifest 的 MCP / 工具策略中拒绝不希望暴露的 server 或 tool。物化后的单个工具名格式为 `服务器ID__工具名`。

---

## CLI 状态

当前 `xopc --help` 不暴露 `mcp` 作为顶层命令。请通过 `xopc.json` 中的 `mcp.servers` 和可用的网关控制台管理 MCP。下面命令仅保留给仍暴露历史 MCP CLI 的安装或开发分支参考。

### 历史服务器管理命令

```bash
xopc mcp list
xopc mcp show [name]
xopc mcp set fetch '{"command":"npx","args":["-y","@modelcontextprotocol/server-fetch"]}'
xopc mcp unset fetch
```

`xopc mcp set` 的第二个参数是服务器条目的 JSON 对象；id 即 `set` / `unset` 使用的名称。

### 入站通道桥接

通过 stdio 把网关会话暴露给外部 MCP 客户端：

```bash
xopc mcp serve --url http://127.0.0.1:18790 --token-file ~/.xopc/gateway.token
```

| 参数 | 说明 |
|------|------|
| `--url` | 网关根地址 |
| `--token` / `--token-file` | Bearer 令牌 |
| `--password` / `--password-file` | 密码鉴权（若网关配置了密码） |
| `--claude-channel-mode` | `auto` \| `on` \| `off` — Claude Desktop 通道兼容 |
| `-v` | 详细日志 |

---

## 网关 REST API

需网关鉴权（Bearer 令牌或配置的密码）。

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/mcp/servers` | GET | 列出已配置及扩展合并后的服务器 |
| `/api/mcp/servers/:id/tools` | GET | 某服务器的工具目录（读已保存配置） |
| `/api/mcp/servers/:id/test` | POST | 连接并拉取工具（请求体可临时覆盖表单字段） |
| `/api/mcp/approvals/respond` | POST | 通道桥接审批占位接口 |

### 测试 / 工具列表响应

每条工具示例：

```json
{
  "name": "fetch__browse",
  "shortName": "browse",
  "description": "Fetch a URL and return readable content"
}
```

控制台 **测试** 与 **查看全部** 弹层使用上述字段。

MCP 配置的增删改通过通用配置 API：`GET /api/config`、`PATCH /api/config`（见 [网关服务](../gateway.md)）。

---

## Web UI

网关控制台 → **设置 → MCP**（`#/settings/agent-mcp`）：

- 会话空闲 TTL
- 可折叠服务器卡片（stdio / SSE / Streamable HTTP）
- Headers 键值编辑（支持粘贴）
- 连接超时
- **测试** 与可搜索的 **查看全部** 工具弹层

完整界面说明见 [MCP 指南](../mcp.md#网关控制台web-ui)。

---

## 安全说明

- stdio MCP 使用过滤后的宿主环境（`host-env-security-policy.json`）。
- 委托子任务不能使用 MCP 工具（`bundle-mcp` 黑名单）。
- `before_tool_call` 扩展钩子可读取 `isMcpTool`、`mcpServerId` 做策略控制。
