---
name: find-skills
description: 帮助用户在 XOPC 工作区中发现、安装和管理 Agent Skills。
license: MIT
---

# Find Skills（查找技能）

本技能帮助你在 XOPC 生态中发现、安装和管理技能。

## 何时使用本技能

当用户有以下行为时使用本技能：

- 问"如何做 X"，而 X 可能是已有对应技能的常见任务
- 说"找一个做 X 的 Skill"或"有没有做 X 的 Skill"
- 问"你能做 X 吗"，而 X 是一种专业能力
- 想要从 GitHub 或 skills.sh 安装技能
- 需要管理已安装的技能（启用、禁用、配置）
- 想要浏览可用技能

## XOPC Skills CLI 命令

XOPC 提供内置的技能管理命令：

### 列出可用技能

```bash
# 列出所有技能（内置 + 工作区 + 全局）
xopc skills list

# 显示详细信息
xopc skills list -v

# JSON 格式
xopc skills list --json
```

### 安装技能

**从 GitHub 安装：**

```bash
# 克隆技能仓库到工作区
git clone <repo-url> ~/.xopc/workspace/main/skills/<skill-name>

# 示例：安装 vercel-react-best-practices
git clone https://github.com/vercel-labs/agent-skills.git ~/.xopc/workspace/main/skills/vercel-react-best-practices-temp
mv ~/.xopc/workspace/main/skills/vercel-react-best-practices-temp/SKILL.md ~/.xopc/workspace/main/skills/vercel-react-best-practices/SKILL.md
rm -rf ~/.xopc/workspace/main/skills/vercel-react-best-practices-temp
```

**使用 `xopc skills install`（适用于含安装规范的技能）：**

```bash
# 安装技能依赖
xopc skills install <skill-name>

# 指定安装方法
xopc skills install <skill-name> -i <install-id>

# 预览模式
xopc skills install <skill-name> --dry-run
```

### 启用/禁用技能

```bash
# 启用技能
xopc skills enable <skill-name>

# 禁用技能
xopc skills disable <skill-name>
```

### 查看技能状态

```bash
# 显示所有技能状态
xopc skills status

# 显示特定技能详情
xopc skills status <skill-name>

# JSON 格式
xopc skills status --json
```

### 配置技能

```bash
# 显示当前配置
xopc skills config <skill-name> --show

# 设置 API 密钥
xopc skills config <skill-name> --api-key=YOUR_API_KEY

# 设置环境变量
xopc skills config <skill-name> --env API_KEY=value --env DEBUG=true
```

### 测试技能

```bash
# 测试所有技能
xopc skills test

# 测试特定技能
xopc skills test <skill-name>

# 验证 SKILL.md 文件
xopc skills test validate ./skills/weather/SKILL.md

# 安全审计
xopc skills test security --deep
```

## 如何帮助用户查找和安装技能

### 第 1 步：理解用户需求

当用户请求帮助时，识别：

1. **领域**（如 React、测试、设计、部署）
2. **具体任务**（如编写测试、创建动画、审查 PR）
3. **这个常见任务是否有现成的技能**

### 第 2 步：搜索技能

**方案 A：先检查已安装的技能**

```bash
xopc skills list -v
```

**方案 B：搜索在线技能仓库**

使用你的浏览能力进行搜索：
- https://skills.sh/ - 官方技能市场
- GitHub：搜索 "agent-skills" 或 "claude-skills"
- 热门仓库：
  - `vercel-labs/agent-skills`
  - `ComposioHQ/awesome-claude-skills`

### 第 3 步：安装技能

**对于 XOPC 兼容的技能：**

1. **检查技能是否有安装规范**（在 SKILL.md 中）：
   ```bash
   xopc skills status <skill-name>
   ```

2. **安装依赖**（如果有）：
   ```bash
   xopc skills install <skill-name>
   ```

**对于 GitHub 技能（手动安装）：**

1. **在工作区创建技能目录**：
   ```bash
   mkdir -p ~/.xopc/workspace/main/skills/<skill-name>
   ```

2. **下载 SKILL.md**：
   ```bash
   # 从 GitHub
   curl -L https://raw.githubusercontent.com/<owner>/<repo>/main/skills/<skill-name>/SKILL.md \
     -o ~/.xopc/workspace/main/skills/<skill-name>/SKILL.md

   # 或克隆后复制
   git clone <repo-url> /tmp/skill-temp
   cp /tmp/skill-temp/skills/<skill-name>/SKILL.md ~/.xopc/workspace/main/skills/<skill-name>/
   rm -rf /tmp/skill-temp
   ```

3. **验证安装**：
   ```bash
   xopc skills list | grep <skill-name>
   ```

### 第 4 步：向用户展示结果

找到相关技能后，展示：

1. **技能名称和描述**
2. **安装状态**（已安装 / 需要安装）
3. **安装命令**（如果未安装）
4. **了解更多信息的链接**

**示例回复：**

```
我发现了一个可能有用的技能！

📦 vercel-react-best-practices
   Vercel Engineering 提供的 React 和 Next.js 性能优化指南。

状态：✅ 已安装

你可以立即开始使用！只需让我帮你处理 React 优化任务即可。
```

**或如果未安装：**

```
我发现了一个可能有用的技能！

📦 vercel-react-best-practices
   Vercel Engineering 提供的 React 和 Next.js 性能优化指南。

要安装它，请运行：
  xopc skills install vercel-react-best-practices

或手动安装：
  mkdir -p ~/.xopc/workspace/main/skills/vercel-react-best-practices
  curl -L https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/vercel-react-best-practices/SKILL.md \
    -o ~/.xopc/workspace/main/skills/vercel-react-best-practices/SKILL.md

了解更多：https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### 第 5 步：主动提供安装

如果用户想要继续，你可以帮他们安装：

```bash
# 对于含安装规范的 XOPC 技能
xopc skills install <skill-name> -y

# 对于 GitHub 技能（自动化）
mkdir -p ~/.xopc/workspace/main/skills/<skill-name>
curl -L <skill-url>/SKILL.md -o ~/.xopc/workspace/main/skills/<skill-name>/SKILL.md
```

## 常见技能分类

| 分类         | 示例查询                                      | 热门技能                          |
| ------------ | --------------------------------------------- | --------------------------------- |
| Web 开发     | react, nextjs, typescript, css, tailwind      | vercel-react-best-practices       |
| 测试         | testing, jest, playwright, e2e                | playwright-testing                |
| DevOps       | deploy, docker, kubernetes, ci-cd             | docker-compose, github-actions    |
| 文档         | docs, readme, changelog, api-docs             | api-documentation                 |
| 代码质量     | review, lint, refactor, best-practices        | code-review-checklist             |
| 设计         | ui, ux, design-system, accessibility          | accessibility-checklist           |
| 生产力       | workflow, automation, git                     | git-workflow                      |

## 技能目录结构

技能必须安装在正确的目录结构中：

```
~/.xopc/workspace/main/skills/
├── <skill-name>/           ← 每个技能需要自己的目录
│   ├── SKILL.md            ← 必需：技能元数据和说明
│   ├── config.json         ← 可选：默认配置
│   └── scripts/            ← 可选：辅助脚本
├── another-skill/
│   └── SKILL.md
└── ...
```

**⚠️ 常见错误：** 不要把 SKILL.md 直接放在 `skills/` 目录下！

**正确：**
```
~/.xopc/workspace/main/skills/my-skill/SKILL.md
```

**错误：**
```
~/.xopc/workspace/main/skills/SKILL.md  ← 不会被加载！
```

## 技能安装方法

### 方法 1：XOPC 内置安装（推荐）

适用于声明了安装依赖的技能：

```bash
# 检查将要安装的内容
xopc skills install <skill-name> --dry-run

# 安装
xopc skills install <skill-name>
```

此方法：
- ✅ 自动安装依赖（brew、pnpm、go 等）
- ✅ 执行安全检查
- ✅ 验证技能
- ✅ 报告任何问题

### 方法 2：手动 GitHub 安装

适用于没有安装规范的技能：

```bash
# 1. 创建目录
mkdir -p ~/.xopc/workspace/main/skills/<skill-name>

# 2. 下载 SKILL.md
curl -L https://raw.githubusercontent.com/<owner>/<repo>/main/skills/<skill-name>/SKILL.md \
  -o ~/.xopc/workspace/main/skills/<skill-name>/SKILL.md

# 3. 验证
xopc skills list | grep <skill-name>
```

### 方法 3：Git Clone

适用于包含多个文件的复杂技能：

```bash
# 克隆到临时目录
git clone <repo-url> /tmp/skill-clone

# 复制技能目录
cp -r /tmp/skill-clone/skills/<skill-name> ~/.xopc/workspace/main/skills/

# 清理
rm -rf /tmp/skill-clone

# 验证
xopc skills status <skill-name>
```

## 故障排除

### 技能未加载

**检查目录结构：**
```bash
# 应显示子目录中的 SKILL.md
ls -la ~/.xopc/workspace/main/skills/<skill-name>/
```

**验证 SKILL.md 格式：**
```bash
xopc skills test validate ~/.xopc/workspace/main/skills/<skill-name>/SKILL.md
```

**检查错误：**
```bash
xopc skills list --json | jq '.diagnostics'
```

### 安装失败

**检查依赖：**
```bash
xopc skills status <skill-name>
```

**手动安装：**
```bash
# 如果技能需要 'curl'
brew install curl  # macOS
sudo apt-get install curl  # Linux
```

**重试：**
```bash
xopc skills install <skill-name>
```

### 技能无法工作

1. **检查是否已启用：**
   ```bash
   xopc skills status <skill-name>
   ```

2. **如需则启用：**
   ```bash
   xopc skills enable <skill-name>
   ```

3. **检查配置：**
   ```bash
   xopc skills config <skill-name> --show
   ```

4. **如需则设置 API 密钥：**
   ```bash
   xopc skills config <skill-name> --api-key=YOUR_KEY
   ```

## 示例

### 示例 1：用户询问 React 性能

**用户：** "如何让我的 React 应用更快？"

**你：**
1. 检查已安装技能：`xopc skills list | grep -i react`
2. 如果找到："你已经安装了 vercel-react-best-practices 技能！"
3. 如果未找到：主动提供安装

### 示例 2：用户想添加测试能力

**用户：** "你能帮我写 Playwright 测试吗？"

**你：**
1. 搜索测试相关技能
2. 找到：`playwright-testing`
3. 安装：
   ```bash
   mkdir -p ~/.xopc/workspace/main/skills/playwright-testing
   curl -L <url>/SKILL.md -o ~/.xopc/workspace/main/skills/playwright-testing/SKILL.md
   ```
4. 验证：`xopc skills status playwright-testing`

### 示例 3：用户想浏览所有技能

**用户：** "你有什么技能？"

**你：**
```bash
xopc skills list -v
```

然后展示带描述的列表。

## 高效管理技能的小贴士

1. **始终验证安装**：安装后运行 `xopc skills list`
2. **检查技能状态**：使用 `xopc skills status <name>` 查看详情
3. **保持技能更新**：定期检查技能更新
4. **审查安全性**：运行 `xopc skills test security` 进行审计
5. **整理工作区**：只保留需要的技能以减少杂乱

## 参考资料

- **技能市场**：https://skills.sh/
- **XOPC Skills CLI**：`xopc skills --help`
- **技能格式**：SKILL.md frontmatter 规范
- **GitHub 技能**：在 GitHub 上搜索 "agent-skills"
