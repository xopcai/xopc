# 内置工具参考

xopcbot 内置了一组工具供 Agent 调用，覆盖文件系统、Shell 命令、Web 请求、记忆搜索等场景。

## 工具列表

| 工具 | 名称 | 描述 |
|------|------|------|
| 🤖 子代理 | `call_subagent` | 调用子 Agent 处理特定任务 |
| 🚀 并行子代理 | `call_subagents` | 并行调用多个子 Agent |
| 📁 文件操作 | `read_file` | 读取文件内容 |
| ✍️ 文件编辑 | `write_file` | 创建或覆盖文件 |
| ✏️ 文件修改 | `edit_file` | 精确编辑文件内容 |
| 📂 目录浏览 | `list_dir` | 列出目录内容 |
| 💻 Shell 执行 | `shell` | 执行 Shell 命令 |
| 🔍 文本搜索 | `grep` | 在文件中搜索文本 |
| 📄 文件查找 | `find` | 按条件查找文件 |
| 🔍 网页搜索 | `web_search` | 使用 Brave Search |
| 📄 网页抓取 | `web_fetch` | 获取网页内容 |
| 📨 发送消息 | `send_message` | 发送消息到通道 |
| 🔍 记忆搜索 | `memory_search` | 搜索记忆文件 |
| 📄 记忆读取 | `memory_get` | 读取记忆片段 |

---

## 🤖 call_subagent

调用一个子 Agent 来处理特定任务。子 Agent 会创建一个新的独立会话，执行完毕后返回结果。

### 适用场景

- 并行处理多个独立任务
- 让专业化 Agent 处理特定领域问题
- 复杂任务分解

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `subagent_name` | string | ❌ | 子 Agent 名称（用于追踪） |
| `task` | string | ✅ | 任务描述 |

### 示例

```
Agent: 请帮我搜索最新的 AI 新闻，同时写一段代码
Tool: call_subagent({
  "subagent_name": "researcher",
  "task": "搜索最新的 AI 新闻，列出前 5 条"
})
Result: 1. OpenAI 发布 GPT-5...
       2. Anthropic 发布 Claude 4...
```

### 返回结果

```json
{
  "content": "搜索结果...",
  "details": {
    "sessionKey": "subagent:researcher:1234567890:abc123",
    "subagentName": "researcher",
    "timestamp": 1234567890000
  }
}
```

---

## 🚀 call_subagents

并行调用多个子 Agent 同时处理不同任务。所有任务会同时执行，提高效率。

### 适用场景

- 并行搜索多个数据源
- 同时分析不同内容
- 独立任务并行处理

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `tasks` | string[] | ✅ | 任务列表 |
| `timeout_ms` | number | ❌ | 单个 subagent 超时时间（毫秒），默认 60000 |

### 示例

```
Agent: 请同时搜索 AI 新闻和天气
Tool: call_subagents({
  "tasks": [
    "搜索最新的 AI 新闻，列出前 3 条",
    "查询北京今天的天气"
  ],
  "timeout_ms": 30000
})
Result: ✅ Task 1:
       1. OpenAI 发布 GPT-5...
       2. Anthropic 发布 Claude 4...
       
       ✅ Task 2:
       北京今天天气：晴，25°C
```

### 返回结果

```json
{
  "content": "Parallel execution complete: 2/2 successful\n\n✅ Task 1: ...",
  "details": {
    "total": 2,
    "successful": 2,
    "failed": 0,
    "results": [
      { "index": 0, "sessionKey": "...", "result": "..." },
      { "index": 1, "sessionKey": "...", "result": "..." }
    ]
  }
}
```

---

## 📁 read_file

读取文件内容。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 文件路径 |

### 示例

```
Agent: 请读取 config.json
Tool: read_file({ "path": "/home/user/config.json" })
Result: { "name": "test", "version": "1.0.0" }
```

---

## ✍️ write_file

创建或覆盖文件。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 文件路径 |
| `content` | string | ✅ | 文件内容 |

### 示例

```
Agent: 创建 hello.txt 文件
Tool: write_file({ "path": "/home/user/hello.txt", "content": "Hello, World!" })
Result: File written successfully.
```

---

## ✏️ edit_file

精确编辑文件（替换指定文本）。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 文件路径 |
| `oldText` | string | ✅ | 要替换的原文 |
| `newText` | string | ✅ | 替换后的文本 |

### 示例

```
Agent: 将 "hello" 改为 "hi"
Tool: edit_file({
  "path": "/home/user/test.txt",
  "oldText": "hello",
  "newText": "hi"
})
Result: File edited successfully.
```

---

## 📂 list_dir

列出目录内容。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 目录路径 |

### 示例

```
Agent: 列出当前目录
Tool: list_dir({ "path": "/home/user" })
Result: file1.txt, file2.txt, folder/
```

---

## 💻 shell

执行 Shell 命令。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `command` | string | ✅ | 要执行的命令 |
| `timeout` | number | ❌ | 超时时间（秒），默认 60 |
| `workdir` | string | ❌ | 工作目录 |

### 示例

```
Agent: 列出文件并统计行数
Tool: shell({ "command": "ls -la | wc -l" })
Result: 23
```

### 注意事项

- 默认超时 60 秒
- 命令在 workspace 目录执行
- stdout 和 stderr 都会返回

---

## 🔍 grep

在文件中搜索文本。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `pattern` | string | ✅ | 搜索模式 (支持正则) |
| `glob` | string | ❌ | 文件匹配模式，默认 `**/*.ts` |
| `path` | string | ❌ | 搜索目录 |
| `caseSensitive` | boolean | ❌ | 是否大小写敏感 |

### 示例

```
Agent: 搜索所有包含 "TODO" 的文件
Tool: grep({ "pattern": "TODO" })
Result: src/agent/service.ts:123: TODO: 修复这个问题
```

---

## 📄 find

按条件查找文件。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `pattern` | string | ✅ | 文件名匹配模式 |
| `path` | string | ❌ | 搜索目录 |
| `type` | string | ❌ | 文件类型 (f/d) |

### 示例

```
Agent: 查找所有测试文件
Tool: find({ "pattern": "*.test.ts" })
Result: src/__tests__/core.test.ts
```

---

## 🔍 web_search

使用 Brave Search API 搜索网页。

### 配置

需要设置环境变量：

```bash
export BRAVE_SEARCH_API_KEY="your-api-key"
```

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `query` | string | ✅ | 搜索关键词 |
| `count` | number | ❌ | 最大结果数，默认 5 |

### 示例

```
Agent: 搜索 Node.js 22 发布信息
Tool: web_search({ "query": "Node.js 22 release", "count": 3 })
Result: 1. Node.js 22 Released
   https://nodejs.org/blog/...
   Major features include...
```

---

## 📄 web_fetch

获取并解析网页内容。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `url` | string | ✅ | 网页 URL |
| `maxChars` | number | ❌ | 最大字符数 |

### 示例

```
Agent: 获取 GitHub 首页内容
Tool: web_fetch({ "url": "https://github.com", "maxChars": 1000 })
Result: <html>...
```

---

## 📨 send_message

发送消息到配置的通道。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `message` | string | ✅ | 消息内容 |
| `channel` | string | ❌ | 通道名称 (telegram) |

### 示例

```
Agent: 发送消息到 Telegram
Tool: send_message({ "message": "Hello from agent!", "channel": "telegram" })
Result: Message sent.
```

---

## 🔍 memory_search

**必需步骤**：在回答关于之前工作、决定、日期、人员、偏好或待办事项之前，搜索 MEMORY.md 和 memory/*.md 文件。返回带有路径和行号的最佳片段。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `query` | string | ✅ | 搜索查询 |
| `maxResults` | number | ❌ | 最大返回结果数，默认 5 |

### 示例

```
Agent: 查找之前讨论的 GitHub token 配置
Tool: memory_search({ "query": "GitHub token configuration" })
Result: [
  {
    "path": "MEMORY.md#L10-L15",
    "snippet": "... github token ...",
    "score": 0.85
  }
]
```

### 返回格式

```json
{
  "results": [
    {
      "path": "MEMORY.md#L10-L15",
      "snippet": "...",
      "score": 0.85,
      "citation": "MEMORY.md#L10-L15"
    }
  ],
  "provider": "simple"
}
```

---

## 📄 memory_get

安全地从 MEMORY.md 或 memory/*.md 文件中读取片段。使用 memory_search 后读取需要的行以保持上下文小巧。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 文件路径 (例如 MEMORY.md 或 memory/2024-01-15.md) |
| `from` | number | ❌ | 起始行号 (1-indexed) |
| `lines` | number | ❌ | 要读取的行数 |

### 示例

```
Agent: 读取 MEMORY.md 的第 10-20 行
Tool: memory_get({ "path": "MEMORY.md", "from": 10, "lines": 10 })
Result: ...文件内容片段...
```

---

## 工具调用流程

```
1. Agent 分析用户请求
       ↓
2. 决定调用哪些工具
       ↓
3. 构造工具参数
       ↓
4. 执行工具
       ↓
5. 返回结果给 Agent
       ↓
6. Agent 总结并回复
```

---

## 限制与注意事项

### 安全限制

| 操作 | 限制 |
|------|------|
| 文件路径 | 限制在 workspace 目录内 |
| Shell 命令 | 默认超时 60 秒 |
| 网络请求 | 需要 API Key |

### 超时配置

修改 `agents.defaults.max_tool_iterations` 控制最大工具调用次数：

```json
{
  "agents": {
    "defaults": {
      "max_tool_iterations": 20
    }
  }
}
```

---

## 自定义工具

通过 Plugin System 注册自定义工具：

```typescript
api.registerTool({
  name: 'my_tool',
  description: 'Do something useful',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input value' }
    },
    required: ['input']
  },
  async execute(params) {
    const input = params.input as string;
    // Do something
    return `Result: ${input}`;
  }
});
```

详见 [插件文档](plugins.md)。
