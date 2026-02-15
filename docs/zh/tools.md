# 内置工具参考

xopcbot 内置了一组工具供 Agent 调用。

## 工具列表

| 工具 | 名称 | 描述 |
|------|------|------|
| 📄 读取 | `read_file` | 读取文件内容 (截断至 50KB/500 行) |
| ✍️ 写入 | `write_file` | 创建或覆盖文件 |
| ✏️ 编辑 | `edit_file` | 替换文件中的文本 |
| 📂 列表 | `list_dir` | 列出目录内容 |
| 💻 Shell | `shell` | 执行 Shell 命令 (截断至 50KB) |
| 🔍 搜索 | `grep` | 在文件中搜索文本 |
| 📄 查找 | `find` | 按条件查找文件 |
| 🔍 网页搜索 | `web_search` | 使用 Brave Search |
| 📄 网页抓取 | `web_fetch` | 获取网页内容 |
| 📨 消息 | `send_message` | 发送消息到通道 |
| 🔍 记忆搜索 | `memory_search` | 搜索记忆文件 |
| 📄 记忆读取 | `memory_get` | 读取记忆片段 |

---

## 📄 read_file

读取文件内容。输出自动截断至前 500 行或 50KB。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 文件路径 |
| `limit` | number | ❌ | 最大行数 (默认 500) |

---

## ✍️ write_file

创建或覆盖文件。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 文件路径 |
| `content` | string | ✅ | 文件内容 |

---

## ✏️ edit_file

替换文件中的指定文本。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 文件路径 |
| `oldText` | string | ✅ | 要替换的文本 |
| `newText` | string | ✅ | 替换文本 |

---

## 📂 list_dir

列出目录内容。

---

## 💻 shell

执行 Shell 命令。输出自动截断至最后 50KB。

### 限制

- 超时: 5 分钟
- 输出截断: 50KB

---

## 🔍 grep

在文件中搜索文本。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `pattern` | string | ✅ | 搜索模式 (支持正则) |
| `glob` | string | ❌ | 文件匹配模式 |
| `path` | string | ❌ | 搜索目录 |
| `ignoreCase` | boolean | ❌ | 忽略大小写 |
| `literal` | boolean | ❌ | 纯文本匹配 |
| `context` | number | ❌ | 上下文行数 |
| `limit` | number | ❌ | 最大结果数 (默认 100) |

---

## 📄 find

按条件查找文件。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `pattern` | string | ✅ | 文件名匹配模式 |
| `path` | string | ❌ | 搜索目录 |
| `limit` | number | ❌ | 最大结果数 |

---

## 🔍 web_search

使用 Brave Search API 搜索网页。

### 配置

```bash
export BRAVE_SEARCH_API_KEY="your-api-key"
```

---

## 📄 web_fetch

获取网页内容。

---

## 📨 send_message

发送消息到配置的通道。

---

## 🔍 memory_search

搜索记忆文件。在回答关于之前工作、决定等问题前必须调用。

---

## 📄 memory_get

从记忆文件读取片段。

---

## 安全限制

| 操作 | 限制 |
|------|------|
| 文件路径 | 限制在 workspace 目录内 |
| Shell 命令 | 超时 5 分钟 |
| 文件大小 | 最大 10MB |
