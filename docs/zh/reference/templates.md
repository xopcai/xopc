# 工作区模板

xopcbot 使用工作区模板文件来自定义代理的行为和知识。这些文件在 `onboard` 过程中自动创建，位于 `~/.xopcbot/workspace/` 目录。

## 模板文件列表

| 文件 | 用途 |
|------|------|
| [SOUL.md](/zh/reference/templates/SOUL) | 代理的核心身份、个性和价值观 |
| [USER.md](/zh/reference/templates/USER) | 关于您的信息、偏好和需求 |
| [TOOLS.md](/zh/reference/templates/TOOLS) | 工具使用说明和最佳实践 |
| [AGENTS.md](/zh/reference/templates/AGENTS) | 代理协作指南 |
| [MEMORY.md](/zh/reference/templates/MEMORY) | 关键信息存储和记忆索引 |
| [IDENTITY.md](/zh/reference/templates/IDENTITY) | 身份和边界定义 |
| [HEARTBEAT.md](/zh/reference/templates/HEARTBEAT) | 主动监控配置 |
| [BOOTSTRAP.md](/zh/reference/templates/BOOTSTRAP) | 启动引导配置 |

## 自动加载

这些文件会在每次对话时自动加载到代理的系统提示中，提供上下文：

1. **SOUL.md** - 定义代理是谁、如何行事
2. **USER.md** - 代理了解的关于您的信息
3. **TOOLS.md** - 工具使用指南
4. **AGENTS.md** - 多代理协作规则

## 记忆系统

记忆文件支持动态更新：

- **MEMORY.md** - 永久记忆的索引
- **memory/*.md** - 按日期或主题组织的记忆片段

代理可以通过 `memory_search` 和 `memory_get` 工具搜索和读取记忆。

## 编辑建议

- 使用 Markdown 格式
- 保持简洁，关键信息放在前面
- 定期更新 USER.md 和 MEMORY.md
- 使用清晰的标题结构
