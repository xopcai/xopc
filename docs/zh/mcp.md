# MCP 服务

MCP（Model Context Protocol）让 xopc 把 Agent 连接到另一个本地程序或远程服务提供的工具。只有信任服务运营方，并且确实需要 xopc 没有直接提供的能力时才添加。

## 连接前检查

确认：

- 服务会暴露哪些工具；
- 它在本地运行，还是会把数据发送到远程服务；
- 它能访问哪些凭据和文件路径；
- 目标 Agent 是否应该使用其中每一个工具。

MCP 服务是以运行账号权限执行的代码。安装命令和远程 URL 都应视为安全敏感信息。

## 在控制台添加服务

1. 打开 **设置 → Agent MCP**。
2. 选择 **添加服务**。
3. 选择本地命令或远程 HTTP 连接。
4. 按服务提供方说明填写命令、URL、环境变量和认证。
5. 保存并运行连接测试。
6. 检查发现的工具列表。
7. 只为目标 Agent 允许需要的工具。

状态健康并出现预期工具时，服务才算就绪。

## 本地命令示例

```json
{
  "mcp": {
    "servers": {
      "example": {
        "command": "example-mcp-server",
        "args": []
      }
    }
  }
}
```

命令必须在启动 Gateway 的环境中可用。系统服务与终端的 `PATH` 不同时，优先使用绝对路径。

## 远程服务示例

```json
{
  "mcp": {
    "servers": {
      "example": {
        "transport": "streamable-http",
        "url": "https://mcp.example.com/mcp"
      }
    }
  }
}
```

认证信息应通过支持的凭据或环境变量机制保存，不要在共享配置示例中写入真实 Bearer Token。

## 远程 OAuth 示例

对于实现了 MCP OAuth 的 Streamable HTTP 服务，只声明 OAuth，不要把 token 写入 `xopc.json`：

```json
{
  "mcp": {
    "servers": {
      "private-example": {
        "transport": "streamable-http",
        "url": "https://mcp.example.com/mcp",
        "auth": {
          "type": "oauth"
        }
      }
    }
  }
}
```

保存服务器后，在卡片上选择**连接**。xopc 使用 Authorization Code + PKCE，打开服务商授权页，并通过一个短期的 `127.0.0.1` listener 接收回调。未填写 `clientId` 时，服务端必须支持动态客户端注册；如果服务商预先分配了 public client id，则填写 `auth.clientId`。

OAuth 只支持 Streamable HTTP，不能与静态 `Authorization` Header 同时配置。凭据按 canonical MCP endpoint 保存在 xopc 本地凭据目录；使用同一端点的所有 Agent 共享一个账号。**断开**会删除本地凭据并清理活动 MCP runtime，但不会在服务商侧撤销授权。

## 按 Agent 限制访问

连接成功不表示所有 Agent 都应使用全部工具。服务连接后检查 Agent 工具策略。写入、删除、消息、支付和账号管理工具只有确实需要时才启用。

## 故障排查

| 问题 | 检查内容 |
| --- | --- |
| 本地服务无法启动 | 命令路径、执行权限、工作目录和环境变量 |
| 远程服务不可达 | URL、TLS 证书、代理、网络策略和认证 |
| OAuth 未打开授权页 | 允许浏览器弹窗，并确认浏览器和本地 Gateway 运行在同一台机器上 |
| OAuth 提示客户端注册失败 | 填写服务商提供的 public `auth.clientId`，或让服务商启用动态客户端注册 |
| 服务健康但工具缺失 | 工具发现结果和 Agent 允许/拒绝策略 |
| 终端正常但 Gateway 失败 | Gateway 服务是否拥有相同的 `PATH`、文件和环境 |
| 连接反复重启 | 服务日志与第一个协议或启动错误 |

修改服务命令或环境变量后重启 Gateway。先测试一个只读工具，再启用外部副作用。
