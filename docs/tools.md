# 内置工具参考

xopcbot 内置了一组工具供 Agent 调用，覆盖文件系统、Shell 命令、Web 请求等场景。

## 工具列表

| 工具 | 名称 | 描述 |
|------|------|------|
| 📁 文件操作 | `read_file` | 读取文件内容 |
| ✍️ 文件编辑 | `write_file` | 创建或覆盖文件 |
| ✏️ 文件修改 | `edit_file` | 精确编辑文件内容 |
| 📂 目录浏览 | `list_dir` | 列出目录内容 |
| 💻 Shell 执行 | `shell` | 执行 Shell 命令 |
| 🔍 网页搜索 | `web_search` | 使用 Brave Search |
| 📄 网页抓取 | `web_fetch` | 获取网页内容 |
| 📨 发送消息 | `send_message` | 发送消息到通道 |

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
- 命令在 `agent.workingDir` 执行
- stdout 和 stderr 都会返回

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
| `channel` | string | ❌ | 通道名称 (telegram/whatsapp) |

### 示例

```
Agent: 发送消息到 Telegram
Tool: send_message({ "message": "Hello from agent!", "channel": "telegram" })
Result: Message sent.
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
