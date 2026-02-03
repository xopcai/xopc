# 技能系统

xopcbot 的技能系统源自 [OpenClaw](https://github.com/openclaw/openclaw)，允许通过 Markdown 文件向 Agent 传授特定技能。

## 什么是技能

技能是 `SKILL.md` 文件，包含：
- 技能元数据（名称、描述）
- 使用说明和示例
- 工具调用模板

Agent 会根据用户请求自动加载相关技能。

## 技能格式

```markdown
---
name: github
description: Interact with GitHub using the gh CLI
---

# GitHub Skill

Use the `gh` CLI to interact with GitHub.

## Available Tools

- `gh repo list <user>` - List repositories
- `gh repo view <repo>` - View repository details
- `gh issue list` - List issues
- `gh pr status` - Check pull request status

## Examples

List user repositories:
```

## 内置技能

| 技能 | 描述 |
|------|------|
| `github` | GitHub CLI 操作 |
| `weather` | 天气查询 |
| `summarize` | 内容摘要 |

## 技能位置

| 类型 | 位置 |
|------|------|
| 内置技能 | `src/agent/skills/<skill-name>/SKILL.md` |
| 用户技能 | `~/.xopcbot/workspace/skills/<skill-name>/SKILL.md` |

## 使用技能

Agent 会自动根据请求加载技能：

```
User: List my GitHub repositories
Agent: (加载 github 技能)
      (使用 gh repo list <user> 工具)
```

## 创建自定义技能

1. 创建技能目录：

```bash
mkdir -p ~/.xopcbot/workspace/skills/my-skill
```

2. 创建 `SKILL.md`：

```markdown
---
name: my-skill
description: My custom skill
---

# My Skill

Description of what this skill does.

## Usage

Use `my_tool` to accomplish tasks.

## Examples

Example usage here.
```

3. 技能会自动被加载。

## 技能元数据

| 字段 | 类型 | 描述 |
|------|------|------|
| `name` | string | 技能名称 |
| `description` | string | 技能描述 |
| `requires` | object | 依赖条件 |
| `install` | array | 安装说明 |
| `always` | boolean | 是否总是加载 |

## 技能加载流程

```
1. 用户发送请求
       ↓
2. Agent 分析请求意图
       ↓
3. 匹配相关技能
       ↓
4. 加载技能内容到上下文
       ↓
5. 使用技能中的工具和示例
```

## 最佳实践

1. **保持简洁**：每个技能专注于一个任务
2. **提供示例**：包含常见使用场景
3. **文档清晰**：说明工具用途和参数
4. **版本管理**：更新技能时保持文档同步

## 故障排除

**技能未被加载？**
- 检查文件名是否为 `SKILL.md`
- 确认 YAML 前置元数据格式正确
- 检查技能目录权限

**工具不可用？**
- 确保 `requires.bins` 中声明了所需命令
- 安装缺失的依赖工具
