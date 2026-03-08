# Harness Engineering Improvements

基于 LangChain 文章 ["Improving Deep Agents with harness engineering"](https://blog.langchain.com/improving-deep-agents-with-harness-engineering/) 的实现。

## 概述

LangChain 团队通过改进 Agent 框架（Harness）而非更换模型，将编码 Agent 从 Terminal Bench 2.0 的 Top 30 提升到 Top 5。本实现将核心策略应用到 xopcbot。

## 核心改进

### 1. 自我验证机制 (Self-Verification)

**文件**: `src/agent/middleware/self-verify.ts`

实现了"Build & Self-Verify"模式：

- **问题**: Agent 经常写完代码就结束，没有验证步骤
- **解决**: 在系统提示中强制要求验证流程
- **流程**: Plan → Build → Verify → Fix

**功能**:
- 追踪文件编辑次数，检测"doom loops"（对同一文件反复修改）
- 在超过阈值（默认 5 次）时注入警告提示
- 在长会话后（默认 4 轮）提醒验证

**配置选项**:
```typescript
{
  maxEditsPerFile: 5,           // 单文件最大编辑次数警告
  enablePreCompletionCheck: true, // 启用完成前检查
  minTurnsForVerification: 4,    // 最小轮数后提醒验证
  resetOnVerification: true      // 验证后重置计数器
}
```

### 2. 系统提示增强

**文件**: `src/agent/system-prompt.ts`

添加了"Problem Solving Workflow"部分：

```markdown
## Problem Solving Workflow

Follow this iterative process for all tasks:

1. **Plan**: Understand the task, read relevant files, create a plan
2. **Build**: Implement with verification in mind
3. **Verify**: Run tests, compare against requirements
4. **Fix**: Analyze errors and fix

Before Declaring Complete:
- [ ] All requirements are met
- [ ] Tests pass
- [ ] Edge cases handled
- [ ] No regressions
```

### 3. AgentService 集成

**文件**: `src/agent/service.ts`

集成点：
- 初始化 `SelfVerifyMiddleware`
- 在 `tool_execution_start` 事件时记录文件编辑
- 在 `turn_end` 时更新轮数计数
- 在 `agent_end` 时输出编辑摘要日志

## 技术细节

### 文件编辑追踪

追踪以下工具操作：
- `write_file` - 文件写入
- `edit_file` - 文件编辑
- `shell` - 构建/测试命令（如 `npm test`, `vitest`）

### 上下文注入

`SelfVerifyMiddleware.getContextInjection()` 返回动态内容：

1. **基础工作流指导** - 始终包含
2. **过度编辑警告** - 当文件编辑次数超过阈值时
3. **完成前提醒** - 当轮数超过最小验证轮数时

### 测试覆盖

**文件**: `src/agent/middleware/__tests__/self-verify.test.ts`

16 个测试用例覆盖：
- 编辑记录和计数
- 过度编辑检测
- 轮数跟踪
- 上下文注入
- 配置管理

## 使用示例

### 正常流程

```
User: "Add a new API endpoint for user creation"

Agent:
1. Plan: 读取现有代码，理解结构
2. Build: 实现 endpoint
3. Verify: 运行测试，检查类型
4. Fix: 修复发现的问题
5. 最终验证后回复
```

### 检测到 Doom Loop

```
User: "Fix this bug"

Agent: (编辑 file.ts 5 次)

系统提示注入:
⚠️ **Pattern Alert**: You have edited "file.ts" 5 times.

This may indicate:
- You're fixing symptoms rather than root causes
- The approach needs reconsideration

Recommendation: 
- Step back and re-read the original task
```

## 未来改进

### 中优先级

1. **环境上下文自动发现**
   - 检测可用工具（Node.js, Python, 等）
   - 注入项目结构概览
   - 识别测试框架

2. **循环检测增强**
   - 基于内容的编辑模式检测
   - 相似错误模式识别

### 低优先级

3. **推理预算管理**
   - 针对支持 reasoning effort 的模型
   - 实现 "Reasoning Sandwich": xhigh → high → xhigh

4. **自动化 Trace 分析**
   - 分析失败模式
   - 生成改进建议

## 参考

- [LangChain Blog Post](https://blog.langchain.com/improving-deep-agents-with-harness-engineering/)
- [Terminal Bench 2.0](https://www.tbench.ai/leaderboard/terminal-bench/2.0)
- [Deep Agents CLI](https://github.com/langchain-ai/deepagents/tree/main/libs/cli)
