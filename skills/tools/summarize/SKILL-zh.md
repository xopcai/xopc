---
name: summarize
description: 对 URL、文件和 YouTube 视频进行摘要总结。
license: MIT
---

# Summarize Skill（摘要技能）

对 URL、文件和 YouTube 视频的内容进行摘要总结。

## 用法

### 对 URL 进行摘要
使用 `web_fetch` 工具获取并总结网页内容：
```bash
web_fetch url="https://example.com/article"
```

### 对文件进行摘要
```bash
read_file path="/path/to/file.md"
```

### 对 YouTube 视频进行摘要
```bash
web_fetch url="https://yewtu.be/watch?v=VIDEO_ID"
```

## 技巧

### 处理长内容
1. 分块处理（每块约 2000 tokens）
2. 分别总结每个块
3. 合并所有摘要

### 处理技术文档
1. 提取代码示例
2. 记录前提条件
3. 列出关键概念/术语

## 示例提示

**针对 URL：**
"阅读此 URL 并总结：主要主题、关键要点（3-5 条要点）、任何可执行事项"

**针对文件：**
"分析此文件并提供：文件类型和用途、关键函数/类、依赖项"
