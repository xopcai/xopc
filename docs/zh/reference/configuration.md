# 配置参考

本页用于定位主要配置区域。对于具体安装版本，`xopc config show`、`xopc config get <path>` 和设置界面显示的有效值最准确。

## 位置与命令

默认文件：`~/.xopc/xopc.json`。

```bash
xopc config path
xopc config show
xopc config get <dot.path>
xopc config set <dot.path> <value>
xopc config unset <dot.path>
xopc config validate
```

`XOPC_CONFIG` 或 `XOPC_CONFIG_PATH` 可以选择其它配置文件，状态 Profile 也会改变默认根目录。

## 顶层区域

| 区域 | 控制内容 |
| --- | --- |
| `agents` | 一份全局继承配置（`agents.defaults`），以及 Agent 个性和显式覆盖（`agents.list`） |
| `userContext` | 用户拥有的共享上下文、隐私和召回行为 |
| `providers` | 模型服务商配置和凭据引用 |
| `channels` | Telegram、微信、飞书和扩展通道设置 |
| `gateway` | 端口、监听、认证、远程连接和 Tailscale |
| `tools` | 搜索、浏览器、媒体、运行环境和其它工具设置 |
| `messages` | 对外消息和文字转语音行为 |
| `mcp` | 外部 MCP 服务连接和生命周期 |
| `extensions` | 扩展启用、停用和扩展配置 |
| `runtimeTools` | 托管 Node.js 与 Python 环境 |
| `heartbeat` | 启用后的周期性 Agent 检查 |

Workflow 和 Automation 通常在对应 Gateway 页面管理，不直接写入 `xopc.json`。

## 常用路径覆盖

| 变量 | 用途 |
| --- | --- |
| `XOPC_STATE_DIR` | 状态根目录 |
| `XOPC_CONFIG` / `XOPC_CONFIG_PATH` | 配置文件 |
| `XOPC_WORKSPACE` | 主工作区覆盖 |
| `XOPC_CREDENTIALS_DIR` | 凭据目录 |
| `XOPC_LOG_DIR` | 日志目录 |
| `XOPC_LOG_LEVEL` | 日志详细程度 |

`OPENAI_API_KEY` 等服务商变量可以通过服务商设置和 `xopc providers schema <provider>` 查看。

## 验证与敏感信息

直接编辑后运行 `xopc config validate`。使用合法 JSON，不要有末尾逗号或重复键。敏感信息优先使用界面或 CLI 凭据命令，分享输出前人工检查。

按任务配置见[配置 xopc](../configuration.md)。
