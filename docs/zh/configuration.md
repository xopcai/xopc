# 配置 xopc

日常设置优先使用桌面或网页控制台；终端修改、自动化和诊断使用 `xopc config`；只有界面没有对应选项时才直接编辑 `xopc.json`。

## 查找当前配置

```bash
xopc config path
xopc config show
xopc config validate
```

默认文件是 `~/.xopc/xopc.json`。Profile、命令行参数或环境变量可能选择其它文件，因此 `xopc config path` 比直接假设默认路径更可靠。

## 安全修改设置

CLI 使用点路径：

```bash
xopc config get agents.default
xopc config set agents.default main
xopc config unset gateway.remote.url
xopc config validate
```

看起来像 JSON 的值会按 JSON 解析。Shell 需要时请为字符串加引号。

修改后：

1. 运行 `xopc config validate`；
2. 如果界面没有显示新值，重启受影响的服务；
3. 执行一个最小验证动作；
4. 继续修改前先检查日志。

Gateway 会自动重载许多设置，但凭据、扩展、消息通道和运行环境变更可能需要重启。

## 常用设置入口

| 目标 | 推荐入口 | 指南 |
| --- | --- | --- |
| 添加服务商或选择模型 | **设置 → 能力 → 模型** | [模型](./models.md) |
| 创建 Agent | **Agent** | [Agent](./routing-system.md) |
| 启用工具 | Agent 编辑页 | [工具](./tools.md) |
| 安装或配置 Skill | **Skill** | [Skill](./skills.md) |
| 连接 MCP 服务 | **设置 → Agent MCP** | [MCP](./mcp.md) |
| 连接消息应用 | **消息通道** | [消息通道](./channels/index.md) |
| 启用远程访问 | **设置 → 远程访问** | [远程访问](./remote-access.md) |
| 修改语音或图像服务商 | **设置 → 能力** | [语音](./voice.md)、[图像](./image-multimodal.md) |

## 直接编辑 JSON

先备份文件，保持 JSON 语法有效，并且一次只改一个部分。最小结构示例：

```json
{
  "agents": {
    "default": "main",
    "list": [
      {
        "id": "main",
        "enabled": true
      }
    ]
  },
  "gateway": {
    "port": 18790
  }
}
```

不要用此示例覆盖已有配置，它有意省略了大部分设置。需要查找字段时使用[配置参考](./reference/configuration.md)。

## 敏感信息

优先使用界面凭据设置或 `xopc providers set-key` 等命令。凭据可能保存在认证配置或环境变量中，而不是主 JSON 文件。

- 不要提交含敏感信息的 `xopc.json`、`.env` 或认证文件。
- 即使已知敏感值会被隐藏，分享 `config show` 输出前仍要人工检查。
- Token 一旦出现在聊天、日志、截图或源码中，应立即轮换。

## Profile 与覆盖项

xopc 可以使用独立状态 Profile 和自定义路径。不同客户端表现不一致时，比较：

```bash
xopc profile list
xopc config path
```

最常见原因是两个客户端使用了不同的状态目录、配置文件或 Gateway 地址。

精确顶层字段、环境变量和路径见[配置参考](./reference/configuration.md)与[数据和文件位置](./workspace.md)。
