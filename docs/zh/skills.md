# Skills 系统使用指南

XOPC 的技能系统基于工作区中的文件：通过 `SKILL.md` 等为 AI 助手添加领域能力与知识。

## 目录

- [什么是 Skill](#什么是-skill)
- [SKILL.md 文件格式](#skillmd-文件格式)
- [技能来源](#技能来源)
- [Skills Hub（Git / 压缩包）](#skills-hubgit--压缩包)
- [智能体运行时：工具](#agent-运行时工具与提示风格)
- [声明环境变量](#声明环境变量)
- [CLI 命令](#cli-命令)
- [配置技能](#配置技能)
- [安装技能依赖](#安装技能依赖)
- [安全扫描](#安全扫描)
- [技能测试](#技能测试)
- [示例技能](#示例技能)

## 什么是 Skill

Skill 是一个包含以下内容的目录：

- `SKILL.md` - 技能的元数据和说明文档（必需）
- 脚本、配置文件、资源文件等（可选）

技能可以帮助 AI 助手：
- 理解特定领域的知识和最佳实践
- 使用特定的 CLI 工具和 API
- 遵循特定的工作流程和规范

## SKILL.md 文件格式

SKILL.md 使用 YAML frontmatter 定义元数据，后面跟着 Markdown 格式的详细说明。

### 基本结构

```markdown
---
name: skill-name
description: 技能的简短描述
homepage: https://example.com
metadata:
  xopc:
    emoji: 📦
    os: [darwin, linux]
    requires:
      bins: [curl, jq]
    install:
      - id: brew-curl
        kind: brew
        formula: curl
        bins: [curl]
        label: Install curl (brew)
---

# Skill 名称

详细说明如何使用这个技能...
```

### Frontmatter 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 技能名称（唯一标识符） |
| `description` | string | 技能的简短描述 |
| `homepage` | string | 项目主页 URL |
| `metadata.xopc.emoji` | string | UI 中显示的图标 |
| `metadata.xopc.os` | string[] | 支持的操作系统：`darwin`, `linux`, `win32` |
| `metadata.xopc.requires` | object | 依赖要求 |
| `metadata.xopc.requires.bins` | string[] | 必需的二进制文件 |
| `metadata.xopc.requires.anyBins` | string[] | 任一可用的二进制文件 |
| `metadata.xopc.install` | array | 安装选项列表 |

### 安装器类型

支持以下安装器类型：

| kind | 说明 | 必需字段 |
|------|------|----------|
| `brew` | Homebrew 包 | `formula` |
| `pnpm` | pnpm 包 | `package` |
| `npm` | npm 包 | `package` |
| `yarn` | Yarn 包 | `package` |
| `bun` | Bun 包 | `package` |
| `go` | Go 模块 | `module` |
| `uv` | Python (uv) | `package` |
| `download` | 直接下载 | `url` |

### 安装器示例

```yaml
install:
  # Homebrew 安装
  - id: brew-curl
    kind: brew
    formula: curl
    bins: [curl]
    label: Install curl (brew)
  
  # npm 安装
  - id: pnpm-tool
    kind: pnpm
    package: some-tool
    bins: [some-tool]
    label: Install via pnpm
  
  # Go 安装
  - id: go-tool
    kind: go
    module: github.com/user/tool/cmd/tool@latest
    bins: [tool]
    label: Install via Go
```

## 技能来源

技能可以从以下位置加载：

1. **Bundled** - 内置于 XOPC 的技能
   - 内置技能随 XOPC 安装提供。
   
2. **Workspace** - 工作区特定的技能
   - 位置：`<workspace>/skills/`
   - 优先级最高

3. **Global** - 全局技能
   - 位置：`~/.xopc/skills/`

4. **Extra** - 额外配置的技能目录
   - 通过配置文件指定

### 优先级

Workspace > Global > Bundled

后加载的技能会覆盖先加载的同名技能。

## Skills Hub（Git / 压缩包）

从 **Git 仓库** 或 **本地/远程压缩包**（zip、tar.gz 等）安装或更新技能到 **`~/.xopc/skills`**。安装记录在 **`skills-lock.json`**（与 skills 目录同级），便于按哈希与来源做 **`hub update`**。

```bash
xopc skills hub pull https://github.com/org/repo.git   # 可选 --ref、--path、--id、--force、--strict-scan
xopc skills hub update my-skill
xopc skills hub lock
xopc skills hub lock --json
```

Hub 安装的技能与全局 `~/.xopc/skills/` 规则一致，仍可用 `skills enable` / `disable` 与 `skills.json` 条目控制。

## 智能体运行时：工具 {#agent-运行时工具与提示风格}

智能体在接入 SkillManager 时注册与技能相关的工具：

| 工具 | 作用 |
|------|------|
| `skills_list` | 当前会话可见技能（尊重 allowlist 与工具门控） |
| `skill_view` | 读取 `SKILL.md` 或 `references/` 等允许子路径下的文件 |
| `skill_manage` | 在 `skills.agentWritePolicy` 允许范围内增删改用户技能 |

**`~/.xopc/skills.json` 顶层字段**（除 `entries` 外）示例含义：

| 字段 | 含义 |
|------|------|
| `toolGating` | 为 `true`（默认）时，声明了所需工具/扩展的技能在未满足条件前不进入列表；设为 `false` 可关闭门控。 |
| `agentWritePolicy` | `skill_manage` 可写范围：`global`、`workspace` 或 `both`（默认 `global`）。 |
| `limits.maxSkillFileBytes` | `skill_view` 单文件最大字节数。 |

**SKILL.md frontmatter**：`disable-model-invocation: true` 时技能仍保留在磁盘，但从面向模型的列表（`<available_skills>`、`skills_list`、`skill_view` 可见性）中排除。

参数与限制详见 [内置工具参考](./tools.md)。

## 声明环境变量

在 SKILL.md 中声明技能依赖的 API 密钥等环境变量**名称**，运行时在 **`skill_view` 成功后**注册到会话，供 **`shell`** 等按名从进程环境透传（**模型永不看到变量值**）。支持的来源（合并去重）：

- Hermes 风格 **`required_environment_variables`**（`{ name: "VAR" }` 数组）
- **`prerequisites.env_vars`**
- **`requires.env`** 或 **`metadata.xopc.requires.env`**

## CLI 命令

### 列出技能

```bash
# 列出所有可用技能
xopc skills list

# 显示详细信息
xopc skills list -v

# JSON 格式输出
xopc skills list --json
```

### 安装技能依赖

```bash
# 安装默认依赖
xopc skills install weather

# 指定安装器
xopc skills install weather -i brew-curl

# 预演（不实际执行）
xopc skills install weather --dry-run
```

### 启用/禁用技能

```bash
# 启用技能
xopc skills enable weather

# 禁用技能
xopc skills disable weather
```

### 查看技能状态

```bash
# 查看所有技能状态
xopc skills status

# 查看特定技能详情
xopc skills status weather

# JSON 格式
xopc skills status --json
```

### 安全审计

```bash
# 审计所有技能
xopc skills audit

# 审计特定技能
xopc skills audit weather

# 显示详细发现
xopc skills audit weather --deep
```

### 配置技能

```bash
# 显示当前配置
xopc skills config weather --show

# 设置 API 密钥
xopc skills config weather --api-key=YOUR_API_KEY

# 设置环境变量
xopc skills config weather --env API_KEY=value --env DEBUG=true
```

### 测试技能

```bash
# 测试所有技能
xopc skills test

# 测试特定技能
xopc skills test weather

# 详细输出
xopc skills test --verbose

# JSON 格式
xopc skills test --format json

# 跳过特定测试
xopc skills test --skip-security
xopc skills test --skip-examples

# 验证 SKILL.md 文件
xopc skills test validate ./skills/weather/SKILL.md

# 检查依赖
xopc skills test check-deps

# 安全审计
xopc skills test security --deep
```

## 配置技能

技能配置文件位于 `~/.xopc/skills.json`。除 **`entries`** 外可配置全局加载行为（见 [智能体运行时](#agent-运行时工具与提示风格)）：

```json
{
  "toolGating": true,
  "agentWritePolicy": "global",
  "limits": {
    "maxSkillFileBytes": 1048576
  },
  "entries": {
    "weather": {
      "enabled": true,
      "apiKey": "your-api-key",
      "env": {
        "WTTR_LANG": "zh",
        "WTTR_UNITS": "m"
      },
      "config": {
        "defaultLocation": "Beijing"
      }
    }
  }
}
```

### 环境变量覆盖

可以使用环境变量覆盖技能配置：

```bash
# 启用/禁用
export XOPC_SKILL_WEATHER_ENABLED=true

# API 密钥
export XOPC_SKILL_WEATHER_API_KEY=your-key

# 环境变量
export XOPC_SKILL_WEATHER_ENV_WTTR_LANG=zh
```

## 安装技能依赖

技能可能依赖外部工具。使用 `skills install` 命令安装：

```bash
# 查看技能需要的依赖
xopc skills status weather

# 安装依赖
xopc skills install weather
```

安装器支持：
- ✅ Homebrew (macOS/Linux)
- ✅ npm/yarn/bun (Node.js)
- ✅ Go modules
- ✅ uv (Python)
- ⏳ 直接下载（开发中）

### 安装流程

1. 解析技能的 `install` 元数据
2. 检查前置条件（如 brew、go 是否已安装）
3. 自动安装缺失的前置条件（如果可能）
4. 执行安装命令
5. 进行安全扫描
6. 报告结果和警告

## 安全扫描

所有技能在安装和加载时都会进行安全扫描。

### 扫描内容

**Critical（严重）**:
- `exec()` 直接命令执行
- `eval()` 动态代码执行
- `child_process` 模块使用
- 文件写入/删除操作
- 网络服务器创建

**Warning（警告）**:
- 环境变量访问
- 当前工作目录访问
- 命令行参数访问
- 定时器使用

### 查看扫描结果

```bash
# 快速审计
xopc skills audit weather

# 详细报告
xopc skills audit weather --deep
```

### 扫描输出示例

```
Security scan results for "weather":
  Critical: 0
  Warnings: 2
  Info: 0

Findings:
  ⚠️  Environment variable access at line 5
  ⚠️  Console output at line 12
```

## 技能测试

XOPC 提供完整的技能测试框架，用于验证技能的质量、安全性和功能性。

### 测试类型

| 测试 | 说明 |
|------|------|
| SKILL.md 格式 | 验证 YAML frontmatter 和必需字段 |
| 依赖检查 | 检查声明的二进制文件是否可用 |
| 安全扫描 | 扫描危险代码模式 |
| 元数据完整性 | 检查 emoji、homepage 等可选字段 |
| 示例验证 | 验证代码块语法 |

### 运行测试

```bash
# 测试所有技能
xopc skills test

# 测试特定技能
xopc skills test weather

# 详细输出
xopc skills test --verbose

# JSON 格式（用于 CI/CD）
xopc skills test --format json

# TAP 格式（用于 CI/CD）
xopc skills test --format tap

# 严格模式（警告也视为失败）
xopc skills test --strict
```

### 测试输出示例

```
Skill Test Results
==================

✅ weather
   SKILL.md format: Valid
   Dependencies: All satisfied
   Security: No issues
   Metadata: Complete
   Examples: 5 code blocks

Summary: 1/1 skills passed
```

### 在 CI/CD 中使用

```yaml
# .github/workflows/skills-test.yml
name: Skills Test

on:
  push:
    paths:
      - 'skills/**'
  pull_request:
    paths:
      - 'skills/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm run build
      - run: xopc skills test --format tap --strict
```

## 示例技能

### 天气技能

```markdown
---
name: weather
description: Get weather information using wttr.in
homepage: https://github.com/chubin/wttr.in
metadata:
  xopc:
    emoji: 🌤️
    requires:
      anyBins: [curl, wget]
    install:
      - id: brew-curl
        kind: brew
        formula: curl
        bins: [curl]
        label: Install curl (brew)
---

# Weather Skill

使用 wttr.in 获取天气信息。

## Quick Start

```bash
curl wttr.in/Beijing
```

## 更多用法

详见 [wttr.in 文档](https://github.com/chubin/wttr.in)
```

### GitHub 技能

```markdown
---
name: github
description: Interact with GitHub via CLI
homepage: https://cli.github.com
metadata:
  xopc:
    emoji: 🐙
    requires:
      bins: [gh]
    install:
      - id: brew-gh
        kind: brew
        formula: gh
        bins: [gh]
        label: Install GitHub CLI (brew)
---

# GitHub Skill

使用 GitHub CLI (gh) 与 GitHub 交互。

## 配置

```bash
gh auth login
```

## 常用命令

```bash
# 查看 PR
gh pr list

# 创建 Issue
gh issue create

# 查看 CI 状态
gh run list
```
```

## 最佳实践

### 创建技能

1. **明确的名称**: 使用小写，连字符分隔（如 `my-skill`）
2. **清晰的描述**: 一句话说明技能用途
3. **完整的文档**: 包含快速开始、示例、参考链接
4. **声明依赖**: 明确列出所需的二进制文件
5. **提供安装器**: 为用户提供多种安装选项
6. **平台支持**: 声明支持的操作系统

### 技能内容

- ✅ 提供 CLI 命令示例
- ✅ 包含常见用例
- ✅ 列出环境变量配置
- ✅ 提供错误处理建议
- ✅ 包含参考文档链接

### 安全考虑

- 避免在技能脚本中使用 `eval()`
- 谨慎使用文件写入操作
- 明确声明网络访问需求
- 提供安全的使用示例

### 测试技能

- 在提交前运行 `skills test`
- 确保所有测试通过
- 修复安全扫描警告
- 验证代码示例可执行

## 故障排除

### 技能未加载

1. 检查 SKILL.md 文件格式是否正确
2. 确认技能目录名称与 `name` 字段匹配
3. 查看 `xopc skills list` 输出
4. 检查是否有命名冲突

### 依赖安装失败

1. 使用 `--dry-run` 查看安装命令
2. 手动执行安装命令排查问题
3. 检查包管理器是否正常工作
4. 查看安全扫描警告

### 技能不工作

1. 检查依赖的二进制文件是否可用：`xopc skills status <name>`
2. 确认技能已启用：`xopc skills enable <name>`
3. 检查配置文件：`xopc skills config <name> --show`
4. 查看详细日志：`XOPC_LOG_LEVEL=debug xopc ...`

### 测试失败

```bash
# 查看详细输出
xopc skills test --verbose

# 跳过特定测试
xopc skills test --skip-security

# 只运行失败的测试（未来支持）
xopc skills test --bail
```

## 参考资料

- [技能测试框架](./skills-testing.md) - 详细的测试框架文档
- [CLI 命令参考](./cli.md) - 所有可用命令

---

_最后更新：2026-04-11_
