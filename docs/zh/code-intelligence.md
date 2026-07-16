# 代码智能

xopc 为 `coder` agent 内置由 codebase-memory-mcp（CBM）提供的代码库理解能力。CBM 将源码索引为本地 SQLite 知识图，xopc 只向 agent 暴露一组精简的只读工具，用于符号发现、源码确认、调用追踪、变更影响和架构分析。

## 默认行为

- 默认只为 `coder` agent 启用代码智能。
- CBM 进程按 workspace 懒启动；使用同一解析后 workspace 的会话共享 runtime。
- 第一个 coder 会话会在后台启动索引。
- 文件工具成功修改工作区后，索引会被标记为 dirty，并在 debounce 后执行增量刷新。
- 进程和知识图均在本地运行。xopc 不会把仓库内容发送给额外模型或托管索引服务。
- CBM 不可用或覆盖不完整时，工具会返回 freshness 警告，并要求 agent 使用 `grep`、`find` 和 `read_file` 读取真实源码。

不要为此集成运行 `codebase-memory-mcp install`。该命令用于配置其他 coding client；xopc 会直接启动内置的 MCP 二进制。

Electron 应用会随包提供对应的 CBM 静态二进制。npm 版本仅在 coder agent 第一次需要代码智能时才下载 CBM，`npm install` 阶段不会下载。按需下载有两分钟时限、会在解压前校验发布清单中的 SHA-256，并原子写入 xopc 状态目录，因此 GitHub Releases 不可达或不可信时不会让包安装卡住，也不会引入可执行文件。

## Agent 工具

| 工具 | 用途 |
|------|------|
| `code_search` | 查找定义、实现、路由、类型和重要符号。 |
| `code_read_symbol` | 修改前读取 qualified symbol 对应的精确源码。 |
| `code_trace` | 追踪调用方、被调用方、数据流和跨服务路径。 |
| `code_impact` | 将 Git diff 或区间映射到受影响符号和影响范围；默认比较 `HEAD` 并限制符号输出规模。 |
| `code_architecture` | 分析包、边界、分层、入口、热点和图聚类。 |

知识图是索引证据，不是事实源。coder prompt 要求在修改代码或声称某段代码不存在之前直接验证源码。

## 配置

仅在需要覆盖默认值时，向 `~/.xopc/xopc.json` 添加 `codeIntelligence`：

```json
{
  "codeIntelligence": {
    "enabled": true,
    "agentIds": ["coder"],
    "indexMode": "moderate",
    "autoIndex": true,
    "autoRefresh": true,
    "refreshDebounceMs": 600,
    "queryTimeoutMs": 20000,
    "indexTimeoutMs": 300000,
    "binaryPath": "/optional/absolute/path/codebase-memory-mcp"
  }
}
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `enabled` | `true` | 设为 false 时关闭托管 runtime 和相关工具。 |
| `agentIds` | `["coder"]` | 获得代码智能工具的 agent manifest。 |
| `indexMode` | `moderate` | 可选 `fast`、`moderate`、`full`；moderate 包含语义边。 |
| `autoIndex` | `true` | 目标 agent 启动时构建或刷新知识图。 |
| `autoRefresh` | `true` | 工作区成功修改后自动刷新。 |
| `refreshDebounceMs` | `600` | 将相邻修改合并成一次增量索引。 |
| `queryTimeoutMs` | `20000` | 图查询最大执行时间。 |
| `indexTimeoutMs` | `300000` | 单次索引最大执行时间。 |
| `binaryPath` | 未设置 | 覆盖 packaged/npm 二进制；也支持 `XOPC_CBM_BINARY`。 |

修改二进制或进程设置后需要重启 gateway。

## Runtime 与存储

xopc 按以下顺序查找二进制：

1. `codeIntelligence.binaryPath`
2. `XOPC_CBM_BINARY`
3. Electron 包内的 `resources/bin`
4. xopc 按需下载后缓存的二进制

索引位于 xopc 状态目录的 `code-intelligence/cbm` 下。每个进程通过 `CBM_ALLOWED_ROOT` 限制在解析后的 workspace 内。CBM 进程边界负责崩溃隔离；清理 workspace runtime 时会同时停止对应进程。

## 故障排查

在源码工作区检查已安装的二进制：

```bash
pnpm exec codebase-memory-mcp --version
```

| 现象 | 处理方式 |
|------|----------|
| 二进制下载失败 | 检查 GitHub Releases 的网络访问，重试 coder 请求，或将 `XOPC_CBM_BINARY` / `codeIntelligence.binaryPath` 设置为可信可执行文件。 |
| 索引超时 | 使用 `indexMode: "fast"`、增加 `indexTimeoutMs`，或缩小 workspace。 |
| 覆盖为 partial/degraded | 对被标记路径使用直接源码工具，不能根据知识图断言代码不存在。 |
| 外部修改后结果过期 | 等待 CBM 自动同步，或重启 gateway 以重建 workspace runtime。 |

## 打包

Electron 构建会把真实二进制复制进应用资源，因此 packaged app 不会在运行时下载 CBM。npm 安装不会运行 CBM 下载；仅在首次使用代码智能且没有配置显式二进制路径时，xopc 才会进行有时限的按需下载。
