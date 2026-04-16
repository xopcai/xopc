# 技能测试框架使用指南

xopc 提供了一套完整的技能测试框架，用于验证技能的质量、安全性和功能性。

## 目录

- [快速开始](#快速开始)
- [测试类型](#测试类型)
- [CLI 命令](#cli-命令)
- [测试框架 API](#测试框架-api)
- [编写技能测试](#编写技能测试)
- [CI/CD 集成](#ci/cd-集成)
- [最佳实践](#最佳实践)

## 快速开始

### 运行所有技能测试

```bash
# 使用 CLI 命令
pnpm run dev -- skills test

# 详细输出
pnpm run dev -- skills test --verbose

# JSON 格式
pnpm run dev -- skills test --format json
```

### 测试单个技能

```bash
# 测试特定技能
pnpm run dev -- skills test weather

# 详细输出
pnpm run dev -- skills test weather --verbose
```

### 运行单元测试

```bash
# 运行测试框架单元测试
pnpm test
```

## 测试类型

测试框架包含以下测试类型：

### 1. SKILL.md 格式验证

验证 SKILL.md 文件的格式是否正确：

- ✅ YAML frontmatter 存在
- ✅ 必需字段（name, description）存在
- ✅ 字段类型正确
- ✅ 内容长度足够

**示例输出：**
```
✓ SKILL.md format: Valid SKILL.md format
```

### 2. 依赖检查

检查技能声明的依赖是否满足：

- ✅ 必需的二进制文件存在
- ✅ `anyBins` 至少有一个可用
- ✅ 安装器配置正确

**示例输出：**
```
✓ Dependencies: All dependencies satisfied
  - Found binary: node
  - Found binary: curl
```

### 3. 安全扫描

扫描技能目录中的代码安全问题：

- ⚠️ 危险函数使用（exec, eval 等）
- ⚠️ 文件系统访问
- ⚠️ 网络操作
- ⚠️ 环境变量访问

**示例输出：**
```
✓ Security: No security issues
  - Critical: 0
  - Warnings: 0
  - Info: 0
```

### 4. 元数据完整性

检查技能元数据是否完整：

- ✅ Emoji 图标
- ✅ Homepage 链接
- ✅ 操作系统限制
- ✅ 安装器定义

**示例输出：**
```
⚠ Metadata: Metadata could be improved
  - Emoji: 🌤️
  - No homepage defined (recommended)
```

### 5. 示例验证

验证 SKILL.md 中的代码示例：

- ✅ 提取代码块
- ✅ 检查 Shell 语法
- ✅ 验证命令格式

**示例输出：**
```
✓ Examples: Examples validated
  - Found 5 code block(s)
  - Shell examples: 3
```

## CLI 命令

### 主测试命令

```bash
# 测试所有技能
xopc skills test

# 测试特定技能
xopc skills test <skill-name>

# 指定技能目录
xopc skills test --skills-dir ./my-skills

# 输出格式（text/json/tap）
xopc skills test --format json

# 详细输出
xopc skills test --verbose

# 严格模式（警告也视为失败）
xopc skills test --strict

# 跳过特定测试
xopc skills test --skip-security
xopc skills test --skip-deps
xopc skills test --skip-examples
```

### 验证命令

```bash
# 验证单个 SKILL.md 文件
xopc skills test validate ./skills/weather/SKILL.md

# 严格模式
xopc skills test validate ./skills/weather/SKILL.md --strict
```

### 依赖检查命令

```bash
# 检查所有技能的依赖
xopc skills test check-deps

# 检查特定技能
xopc skills test check-deps weather
```

### 安全审计命令

```bash
# 审计所有技能
xopc skills test security

# 审计特定技能
xopc skills test security weather

# 详细输出
xopc skills test security --deep
```

## 测试框架 API

### 基本使用

```typescript
import { SkillTestFramework } from './agent/skills/test-framework.js';

// 创建测试框架实例
const framework = new SkillTestFramework({
  skipSecurity: false,      // 是否跳过安全测试
  skipDeps: false,          // 是否跳过依赖测试
  skipExamples: false,      // 是否跳过示例测试
  strict: false,            // 严格模式
  exampleTimeout: 10000,    // 示例测试超时（ms）
});

// 测试单个技能
const report = await framework.testSkill('/path/to/skill');

console.log(`Passed: ${report.passed}`);
console.log(`Results: ${report.summary.passed}/${report.summary.total}`);

// 访问详细结果
for (const result of report.results) {
  console.log(`${result.name}: ${result.status} - ${result.message}`);
  if (result.details) {
    for (const detail of result.details) {
      console.log(`  - ${detail}`);
    }
  }
}
```

### 批量测试

```typescript
import { SkillTestRunner } from './agent/skills/test-framework.js';

const runner = new SkillTestRunner({
  skillsDir: './skills',
  skipSecurity: false,
  skipDeps: false,
  skipExamples: true,  // 批量测试时通常跳过示例
  verbose: true,
});

const { reports, passed } = await runner.run();

console.log(`Tested ${reports.length} skills`);
console.log(`All passed: ${passed}`);
```

### 结果格式化

```typescript
import { 
  formatTestResults,
  formatTestResultsJson,
  formatTestResultsTap,
} from './agent/skills/test-framework.js';

// 文本格式
const textOutput = formatTestResults(reports, true);
console.log(textOutput);

// JSON 格式
const jsonOutput = formatTestResultsJson(reports);
console.log(jsonOutput);

// TAP 格式（用于 CI/CD）
const tapOutput = formatTestResultsTap(reports);
console.log(tapOutput);
```

## 编写技能测试

### 单元测试示例

```typescript
import { describe, it, expect } from 'vitest';
import { SkillTestFramework } from '../test-framework.js';

describe('My Skill Tests', () => {
  it('should have valid SKILL.md format', () => {
    const framework = new SkillTestFramework();
    const result = framework.testSkillMdFormat('./skills/my-skill/SKILL.md');
    
    expect(result.status).toBe('pass');
  });

  it('should have all dependencies', async () => {
    const framework = new SkillTestFramework();
    const metadata = {
      name: 'my-skill',
      description: 'My skill',
      requires: {
        bins: ['node', 'npm'],
      },
    };
    
    const result = await framework.testDependencies(metadata);
    expect(result.status).toBe('pass');
  });
});
```

### 集成测试示例

```typescript
import { describe, it, expect } from 'vitest';
import { SkillTestRunner } from '../test-framework.js';

describe('Skills Integration Tests', () => {
  it('should pass all skills tests', async () => {
    const runner = new SkillTestRunner({
      skillsDir: './skills',
      skipExamples: true,  // Skip slow example tests
    });

    const { reports, passed } = await runner.run();
    
    expect(passed).toBe(true);
    expect(reports.length).toBeGreaterThan(0);
  });
});
```

## CI/CD 集成

### GitHub Actions

项目已包含预配置的 GitHub Actions workflow：

```yaml
# .github/workflows/skills-test.yml
name: Skills Test

on:
  push:
    paths:
      - 'skills/**'
      - 'src/**/skills/**'
  pull_request:
    paths:
      - 'skills/**'

jobs:
  test-skills:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: pnpm install
      - run: pnpm run build
      - run: xopc skills test --verbose
```

### 自定义 CI 配置

```yaml
name: Custom Skills Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Build
        run: pnpm run build
      
      - name: Run skill tests
        run: |
          xopc skills test \
            --format tap \
            --skip-examples \
            --strict
      
      - name: Security audit
        run: xopc skills test security --deep
```

### 本地回归测试

```bash
#!/bin/bash
# scripts/test-skills-local.sh

set -e

echo "Running local skill regression tests..."

# Run unit tests
pnpm test

# Run integration tests
xopc skills test --verbose

# Run security audit
xopc skills test security --deep

echo "All tests passed!"
```

## 最佳实践

### 1. 测试覆盖

确保每个技能都通过以下测试：

- ✅ SKILL.md 格式验证
- ✅ 依赖检查
- ✅ 安全扫描
- ✅ 元数据完整性

### 2. CI/CD 集成

在 CI/CD 流程中：

- 运行所有技能测试
- 启用严格模式
- 失败时阻止合并
- 生成测试报告

### 3. 本地开发

在本地开发技能时：

```bash
# 快速验证格式
xopc skills test validate ./skills/my-skill/SKILL.md

# 检查依赖
xopc skills test check-deps my-skill

# 完整测试
xopc skills test my-skill --verbose
```

### 4. 性能优化

对于大量技能：

```bash
# 跳过慢速测试
xopc skills test --skip-examples

# 只测试变更的技能（未来支持）
xopc skills test --changed-since HEAD~1
```

### 5. 测试报告

生成测试报告：

```bash
# JSON 格式（用于机器读取）
xopc skills test --format json > test-results.json

# TAP 格式（用于 CI/CD）
xopc skills test --format tap > test-results.tap

# 详细文本（用于人工阅读）
xopc skills test --verbose > test-results.txt
```

## 故障排除

### 测试失败

```bash
# 查看详细输出
xopc skills test --verbose

# 跳过特定测试
xopc skills test --skip-security
```

### 依赖问题

```bash
# 检查所有依赖
xopc skills test check-deps

# 安装缺失的依赖
xopc skills install <skill-name>
```

### 安全问题

```bash
# 详细安全审计
xopc skills test security --deep

# 查看具体发现
xopc skills audit <skill-name> --deep
```

## 测试输出格式

### 文本格式（默认）

人类可读的详细输出：

```
Skill Test Results
==================

✅ weather
   SKILL.md format: Valid SKILL.md format
   Dependencies: All dependencies satisfied
   Security: No security issues
   Metadata: Complete
   Examples: 5 code block(s)

Summary: 1/1 skills passed
```

### JSON 格式

用于机器读取和 CI/CD 集成：

```json
{
  "totalSkills": 1,
  "passedSkills": 1,
  "failedSkills": 0,
  "reports": [
    {
      "skillName": "weather",
      "skillPath": "./skills/weather",
      "passed": true,
      "results": [
        {
          "name": "SKILL.md format",
          "status": "pass",
          "message": "Valid SKILL.md format"
        }
      ]
    }
  ]
}
```

### TAP 格式

用于 CI/CD 系统的 Test Anything Protocol：

```
TAP version 13
1..2
ok 1 - weather/SKILL.md format
ok 2 - weather/Dependencies
```

## 参考资料

- [技能系统使用指南](./skills.md)
- 技能测试框架与示例位于 xopc 源码仓库中，与 `skills test` 等 CLI 实现相邻。

---

_最后更新：2026-02-22_
