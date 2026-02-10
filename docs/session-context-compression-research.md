# Session 上下文压缩方案调研报告

## 背景

xopcbot 目前使用简单的 JSON 文件存储完整对话历史，没有上下文压缩机制。当对话达到上百轮时：
- Token 消耗急剧增加
- 可能触发模型上下文限制
- 响应延迟增加
- 成本上升

## OpenClaw 的方案（深度调研）

OpenClaw 采用**双层压缩策略**：

### 1. Compaction（持久化压缩）

**触发时机**：
- 模型返回上下文溢出错误时（自动恢复）
- 当 `contextTokens > contextWindow - reserveTokens` 时（阈值维护）

**工作原理**：
```
原始对话: [Msg1, Msg2, Msg3, Msg4, Msg5, Msg6, Msg7]
                    ↓ Compaction
压缩后:   [Summary(1-4), Msg5, Msg6, Msg7]
```

- 将早期对话总结为摘要（`compaction` entry）
- 保留最近消息完整（可配置 `keepRecentTokens`）
- 摘要持久化到 JSONL 文件
- 记录 `compactionCount` 统计压缩次数

**配置参数**：
```json5
{
  compaction: {
    enabled: true,
    reserveTokens: 16384,  // 保留给下一次输出的空间
    // 模式: default | safeguard
    // - default: 正常压缩
    // - safeguard: 更激进的压缩策略
  }
}
```

### 2. Session Pruning（临时裁剪）

**触发时机**：
- 仅在 Anthropic API 调用时
- 当上次调用超过 TTL（默认 5 分钟）时

**工作原理**：
- **Soft-trim**: 超大工具结果裁剪（保留头尾，中间用 `...` 代替）
- **Hard-clear**: 旧工具结果替换为占位符 `[Old tool result content cleared]`
- 用户和助手消息**永不修改**
- 仅影响发送到模型的内容，不修改持久化历史

**配置参数**：
```json5
{
  contextPruning: {
    mode: "cache-ttl",      // off | cache-ttl
    ttl: "5m",              // 触发裁剪的时间阈值
    keepLastAssistants: 3,  // 保护最近N条助手消息
    tools: {
      allow: ["exec", "read"],  // 允许裁剪的工具
      deny: ["*image*"]         // 禁止裁剪的工具
    }
  }
}
```

## 业界常见方案对比

| 方案 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|----------|
| **滑动窗口** | 保留最近N轮，丢弃旧消息 | 简单、确定性强 | 丢失早期上下文 | 简单对话、状态无关 |
| **LLM摘要** (OpenClaw) | 用LLM生成历史摘要 | 保留语义、可定制 | 需要额外API调用 | 长对话、需要历史感 |
| **RAG检索** | 向量化存储，检索相关 | 精准、可扩展 | 实现复杂、需要向量DB | 知识库问答 |
| **分层记忆** | 短期+长期+工作记忆 | 模拟人类记忆 | 架构复杂 | 复杂Agent系统 |
| **Token采样** | 按重要性采样保留 | 保留关键信息 | 难以定义重要性 | 特定领域 |

## 对 xopcbot 的建议方案

### 推荐：渐进式实现（3个阶段）

#### Phase 1: 滑动窗口（快速实现，立即见效）

```typescript
// src/agent/memory/store.ts
interface MemoryConfig {
  maxMessages: number;      // 保留最大消息数
  keepSystemMessages: boolean;  // 是否保留所有系统消息
}

// 实现简单裁剪
function trimMessages(messages: AgentMessage[], config: MemoryConfig): AgentMessage[] {
  if (messages.length <= config.maxMessages) return messages;
  
  // 保留系统消息 + 最近N条
  const systemMessages = messages.filter(m => m.role === 'system');
  const recentMessages = messages.slice(-config.maxMessages);
  
  return [...systemMessages, ...recentMessages];
}
```

**效果**: 简单有效，但会丢失早期上下文。

#### Phase 2: LLM摘要（参考 OpenClaw Compaction）

```typescript
// 新增 src/agent/memory/compaction.ts
interface CompactionResult {
  summary: string;          // 摘要内容
  firstKeptIndex: number;   // 从哪条开始保留完整
  tokensBefore: number;     // 压缩前token数
  tokensAfter: number;      // 压缩后token数
}

class SessionCompactor {
  async compact(
    messages: AgentMessage[],
    model: Model,
    instructions?: string  // 可选：指导摘要重点
  ): Promise<CompactionResult> {
    // 1. 构建摘要提示词
    const summaryPrompt = this.buildSummaryPrompt(messages, instructions);
    
    // 2. 调用轻量级模型生成摘要
    const summary = await this.generateSummary(summaryPrompt, model);
    
    // 3. 返回压缩结果
    return {
      summary,
      firstKeptIndex: messages.length - this.keepRecent,
      tokensBefore: this.estimateTokens(messages),
      tokensAfter: this.estimateTokens(summary) + this.keepRecentTokens,
    };
  }
}
```

**配置建议**（参考 OpenClaw）：
```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "enabled": true,
        "mode": "default",
        "reserveTokens": 8000,      // 预留空间
        "triggerThreshold": 0.8,    // 当使用80%上下文时触发
        "minMessagesBeforeCompact": 10  // 至少10条才压缩
      }
    }
  }
}
```

**触发策略**：
1. **自动触发**: 每次对话前检查 token 数，超过阈值自动压缩
2. **错误恢复**: 收到上下文溢出错误时自动压缩重试
3. **手动触发**: 用户发送 `/compact` 命令强制压缩

#### Phase 3: 工具结果裁剪（参考 OpenClaw Pruning）

```typescript
// 新增 src/agent/memory/pruning.ts
interface PruningConfig {
  enabled: boolean;
  maxToolResultLength: number;   // 工具结果最大长度
  headKeepRatio: number;         // 头部保留比例
  tailKeepRatio: number;         // 尾部保留比例
  placeholder: string;           // 裁剪占位符
}

class ToolResultPruner {
  prune(toolResults: AgentMessage[]): AgentMessage[] {
    return toolResults.map(msg => {
      if (msg.role !== 'tool') return msg;
      
      const content = this.extractContent(msg);
      if (content.length <= this.config.maxToolResultLength) return msg;
      
      // Soft-trim: 保留头尾
      const headLength = Math.floor(
        this.config.maxToolResultLength * this.config.headKeepRatio
      );
      const tailLength = Math.floor(
        this.config.maxToolResultLength * this.config.tailKeepRatio
      );
      
      const trimmed = 
        content.slice(0, headLength) + 
        `\\n... (${content.length - headLength - tailLength} chars truncated) ...\\n` +
        content.slice(-tailLength);
      
      return this.updateContent(msg, trimmed);
    });
  }
}
```

## 具体实施建议

### 1. 优先级

| 优先级 | 方案 | 原因 |
|--------|------|------|
| P0 | 滑动窗口 | 1小时实现，解决80%问题 |
| P1 | 自动Compaction | 参考 OpenClaw，核心功能 |
| P2 | Tool Pruning | 针对工具密集型对话 |
| P3 | RAG长期记忆 | 复杂，需要向量DB |

### 2. xopcbot 配置扩展

```typescript
// src/config/schema.ts
export const CompactionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(['default', 'safeguard']).default('default'),
  reserveTokens: z.number().default(8000),
  triggerThreshold: z.number().min(0.5).max(0.95).default(0.8),
  minMessagesBeforeCompact: z.number().default(10),
  keepRecentMessages: z.number().default(5),  // 保留最近N条完整
});

export const PruningConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxToolResultChars: z.number().default(10000),
  headKeepRatio: z.number().default(0.3),
  tailKeepRatio: z.number().default(0.3),
});

export const AgentDefaultsSchema = z.object({
  // ... existing fields
  compaction: CompactionConfigSchema.default({}),
  pruning: PruningConfigSchema.default({}),
});
```

### 3. 与 AgentService 集成

```typescript
// src/agent/service.ts
export class AgentService {
  private compactor: SessionCompactor;
  private pruner: ToolResultPruner;

  private async checkAndCompact(sessionKey: string): Promise<void> {
    const messages = await this.memory.load(sessionKey);
    const estimatedTokens = this.estimateTokens(messages);
    const maxTokens = this.getModelContextWindow();
    
    // 检查是否需要压缩
    if (estimatedTokens > maxTokens * this.config.compaction.triggerThreshold) {
      const result = await this.compactor.compact(messages, this.model);
      
      // 将摘要插入消息列表
      const compactedMessages = [
        { role: 'system', content: `[Previous conversation summary]: ${result.summary}` },
        ...messages.slice(result.firstKeptIndex),
      ];
      
      await this.memory.save(sessionKey, compactedMessages);
      
      log.info({
        sessionKey,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
      }, 'Session compacted');
    }
  }
}
```

### 4. 监控指标

建议添加以下指标：
- `compaction_count`: 压缩次数
- `tokens_before_compact`: 压缩前token数
- `tokens_after_compact`: 压缩后token数
- `context_utilization`: 上下文使用率

## 参考资源

1. **OpenClaw 官方文档**:
   - `/concepts/compaction` - Compaction 概念
   - `/concepts/session-pruning` - Pruning 概念
   - `/reference/session-management-compaction` - 实现细节

2. **相关论文**:
   - "Efficient Large Language Model Inference with Limited Memory"
   - "Compressing Context for Efficient Long-Context LLM Reasoning"

3. **开源实现**:
   - LangChain ConversationBufferWindowMemory
   - LangChain ConversationSummaryMemory
   - AutoGPT 的记忆系统

## 总结

对于 xopcbot 当前阶段，建议：

1. **立即实施**: 滑动窗口（简单有效）
2. **近期实施**: LLM摘要压缩（参考 OpenClaw，效果最佳）
3. **按需实施**: Tool Pruning（针对工具密集型场景）

这样可以平衡实现复杂度和效果，避免过早优化。
