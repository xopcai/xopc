# MCP（Model Context Protocol）

XOPC 支持两类 MCP 能力：

- **出站 bundle-MCP**：智能体作为客户端连接外部 MCP 服务，在对话里使用对方提供的工具。
- **入站通道桥接**（`xopc mcp serve`）：把网关会话暴露给外部 MCP 客户端（如 Claude Desktop），走 stdio 协议。

本文说明配置方式、网关控制台操作、工具命名规则、生命周期与安全注意点。CLI 与 HTTP API 详见 [MCP CLI 与 API](./cli/mcp.md)。

---

## 目录

- [工作原理](#工作原理)
- [配置说明](#配置说明)
- [网关控制台（Web UI）](#网关控制台web-ui)
- [关闭 MCP 工具](#关闭-mcp-工具)
- [扩展自带的 MCP](#扩展自带的-mcp)
- [生命周期](#生命周期)
- [安全说明](#安全说明)
- [相关文档](#相关文档)

---

## 工作原理

1. 在 `~/.xopc/xopc.json`（或 `XOPC_CONFIG` 指向的文件）里配置 `mcp.servers`。
2. 智能体每一轮运行时，XOPC 会为当前会话建立或复用 **MCP 运行时**，连接各服务器并拉取工具列表。
3. 工具在模型侧的名称格式为 **`服务器ID__工具名`**（中间两个下划线）。例如服务器 id 为 `fetch`、远端工具名为 `browse` → `fetch__browse`。
4. 模型可以像调用内置工具一样调用这些 MCP 工具；描述文案来自 MCP 服务端（缺失时会用 title 或兜底说明补齐）。

**传输方式**

| 类型 | 配置方式 | 适用场景 |
|------|----------|----------|
| **stdio** | `command` + 可选 `args`、`cwd`、`env` | 本地子进程启动的 MCP（`npx`、`uvx`、自研二进制等） |
| **SSE** | `url` + `transport: "sse"` | 基于 SSE 的远程 MCP |
| **Streamable HTTP** | `url` + `transport: "streamable-http"` | 流式 HTTP 远程 MCP（国内很多 SaaS 开放平台采用类似方式） |

扩展包可在根目录提供 `.mcp.json`，会与用户配置 **合并**（同名服务器以用户配置为准）。

---

## 配置说明

在配置文件中增加 `mcp` 段：

```json
{
  "mcp": {
    "sessionIdleTtlMs": 600000,
    "servers": {
      "fetch": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-fetch"]
      },
      "teambition": {
        "url": "https://example.com/api/mcp",
        "transport": "streamable-http",
        "headers": {
          "Authorization": "Bearer ${TEAMBITION_TOKEN}"
        },
        "connectionTimeoutMs": 60000
      }
    }
  }
}
```

### 顶层字段

| 字段 | 说明 |
|------|------|
| `sessionIdleTtlMs` | 会话级 MCP 客户端空闲多久后回收。默认 **10 分钟**（`600000` 毫秒）。设为 **`0`** 表示不因空闲而回收。 |
| `servers` | 服务器 id → 连接定义。id 即工具名前缀（`id__工具名`）。 |

### stdio 服务器字段

| 字段 | 说明 |
|------|------|
| `command` | 启动命令（stdio 必填） |
| `args` | 参数数组（可选） |
| `cwd` | 工作目录（可选） |
| `env` | 传给子进程的环境变量，支持 `${环境变量名}`。宿主环境会经 **安全过滤**（见 [安全说明](#安全说明)） |
| `connectionTimeoutMs` | 连接、拉取工具列表、调用工具的超时（毫秒，可选；默认 **30 秒**） |

### HTTP 服务器字段

| 字段 | 说明 |
|------|------|
| `url` | MCP 服务地址（`http://` 或 `https://`，远程必填） |
| `transport` | `"sse"` 或 `"streamable-http"`；仅有 `url` 时默认 streamable HTTP |
| `headers` | 请求头（如 `Authorization`），支持 `${环境变量名}` |
| `connectionTimeoutMs` | 同 stdio（可选） |

同一服务器条目 **不能** 同时配置 `command` 和 `url`。

### 编辑配置

当前 `xopc --help` 不暴露 `mcp` 作为顶层命令。请直接编辑 `xopc.json` 中的 `mcp.servers`，或在可用时使用网关控制台。

[MCP CLI 与 API](./cli/mcp.md) 保留历史命令，供仍暴露这些子命令的安装或开发分支参考。

---

## 网关控制台（Web UI）

在网关控制台打开 **设置 → MCP**（路由 `#/settings/agent-mcp`）。需先保存网关访问令牌（与其它设置页相同）。

### 运行时

- **会话空闲 TTL（分钟）** — 对应 `mcp.sessionIdleTtlMs`。留空用默认 10 分钟；填 `0` 表示关闭空闲回收。

### MCP 服务器

每个服务器一张 **可折叠卡片**（保存成功或刷新页面后默认收起，避免列表过长）。

| 界面项 | 配置字段 |
|--------|----------|
| 服务器类型 | `transport`（stdio / SSE / Streamable HTTP） |
| 服务器名称 | `mcp.servers` 的键（工具前缀） |
| 服务器地址 | `url`（HTTP 类传输） |
| Headers | 键值对编辑器 → `headers`（支持粘贴 JSON 或 `Key: Value` 多行） |
| 超时时间（秒） | `connectionTimeoutMs` |
| 命令 / 参数 / 工作目录 / 环境变量 | stdio 相关字段 |

**常用操作**

- **测试** — 用当前表单内容（含未保存修改）连接服务器并拉取工具列表；卡片上显示工具数量。
- **查看全部** — 打开可搜索弹层：短工具名、一行描述（悬停看全文）、完整 `服务器ID__工具名`。
- **删除** — 从表单移除该服务器（需点 **保存** 才写入磁盘）。
- **添加服务器** — 新建卡片默认 **展开**，方便填写。

点击卡片左侧（箭头 + 标题行）可展开/收起；**保存** 成功后全部收起，方便浏览多个服务器。

点击 **保存** 后通过 `PATCH /api/config` 写入 `~/.xopc/xopc.json`。

---

## 关闭 MCP 工具

**关闭某个智能体配置下的全部 MCP 工具：**

```json
{
  "agents": {
    "defaults": {
      "tools": {
        "disable": ["bundle-mcp"]
      }
    }
  }
}
```

也可在 `agents.list` 某一条的 `tools.disable` 里加入 `bundle-mcp`。

**关闭单个 MCP 工具** — 在 `disable` 里写完整工具名，例如 `fetch__browse`。

控制台路径：**设置 → 智能体默认 → 工具**，可关闭 **MCP** 分组或指定工具 id。

委托子任务（delegate）**不能** 使用 MCP 工具。

---

## 扩展自带的 MCP

扩展可在包根目录放置 `.mcp.json`。运行时与用户 `mcp.servers` 合并：

- **同名**服务器 → 以用户配置为准；
- **不同名** → 一并加载，工具分别带各自服务器 id 前缀。

修改扩展或 MCP 配置后，需重启网关或触发热加载。

---

## 生命周期

MCP 运行时按 **会话 key**（对话 / 智能体上下文）隔离：

- 首次需要 MCP 工具时创建；
- 空闲未超过 TTL 则复用；
- 在以下情况销毁：网关关闭、`mcp.*` 配置热更新、删除会话、驱逐智能体、独立自动化运行结束等。

`mcp` 相关配置变更会触发热加载（见 [配置参考](./configuration.md)）。

---

## 安全说明

- **stdio 环境变量** — 子进程环境经 `host-env-security-policy.json` 过滤，避免把危险宿主变量传给 MCP 进程。
- **密钥** — `headers` / `env` 建议写 `${环境变量名}`，不要把 Token 明文提交进 Git 跟踪的配置文件。
- **HTTP 地址** — 仅允许 `http://` 与 `https://`。
- **扩展钩子** — `before_tool_call` 可拿到 `isMcpTool`、`mcpServerId` 做自定义策略。
- **委托任务** — 子 agent 不能调用 MCP 工具。

---

## 相关文档

- [MCP CLI 与 API](./cli/mcp.md) — `xopc mcp`、`xopc mcp serve`、REST 接口
- [内置工具](./tools.md) — 工具总览
- [配置参考](./configuration.md) — 完整配置说明
- [扩展系统](./extensions.md) — 扩展与 `.mcp.json`
- [网关服务](./gateway.md) — 启动网关与鉴权
