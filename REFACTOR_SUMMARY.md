# Telegram Channel 重构总结

## 概述

本次重构基于 openclaw 项目的 Telegram channel 设计，将 xopcbot 的 Telegram channel 从单体架构改造为插件化架构，并引入了多项生产级功能。

## 重构阶段

### P0: 核心架构重构 ✅

**新增文件:**
- `src/channels/types.ts` - Channel 插件接口和类型定义
- `src/channels/access-control.ts` - 分层访问控制工具
- `src/channels/update-offset-store.ts` - Update offset 持久化
- `src/channels/telegram-plugin.ts` - 插件化 Telegram 实现

**核心改进:**

1. **插件化架构**
   - 定义 `ChannelPlugin` 接口
   - 实现 `TelegramChannelPlugin` 类
   - 支持多账户并发运行
   - 保持向后兼容 (legacy 模式)

2. **分层访问控制**
   ```typescript
   // 三级配置层次
   Channel → Group → Topic
   
   // 支持策略
   - dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled'
   - groupPolicy: 'open' | 'disabled' | 'allowlist'
   ```

3. **Update Offset 持久化**
   - 避免重启后重复处理消息
   - 支持内存缓存减少磁盘 I/O
   - 自动去重更新

4. **配置 Schema 扩展**
   ```json
   {
     "channels": {
       "telegram": {
         "enabled": true,
         "token": "LEGACY_TOKEN",
         "dmPolicy": "pairing",
         "groupPolicy": "open",
         "accounts": {
           "personal": {
             "token": "TOKEN_1",
             "allowFrom": [123456]
           },
           "work": {
             "token": "TOKEN_2",
             "groups": {
               "-1001234567890": {
                 "requireMention": true,
                 "systemPrompt": "Work assistant"
               }
             }
           }
         }
       }
     }
   }
   ```

### P1: 流式预览和格式化 ✅

**新增文件:**
- `src/channels/draft-stream.ts` - 流式消息预览
- `src/channels/format.ts` - Markdown 到 HTML 格式化

**核心功能:**

1. **DraftStream 流式预览**
   ```typescript
   const stream = telegramPlugin.startStream({ chatId });
   stream.update('Hello');
   stream.update('Hello World');
   await stream.end();
   ```
   
   - 实时编辑更新消息
   - 节流控制 (默认 1s)
   - 自动清理预览
   - 支持多聊天并发

2. **HTML 格式化**
   - Markdown → HTML 转换
   - 支持 Telegram 特有标签 (`<tg-spoiler>`)
   - 文件引用保护 (`.md`, `.py` 等)
   - 自动分割长消息 (4000 字符)

3. **文件引用保护**
   ```typescript
   // 防止 README.md 被识别为 URL
   README.md → <code>README.md</code>
   
   // 保护的扩展名
   md, go, py, pl, sh, am, at, be, cc
   ```

### P2: Webhook 支持 ✅

**新增文件:**
- `src/channels/telegram-webhook.ts` - Webhook 服务器

**核心功能:**

1. **Webhook 服务器**
   ```typescript
   const server = await startTelegramWebhook({
     bot,
     token: 'BOT_TOKEN',
     secret: 'WEBHOOK_SECRET',
     publicUrl: 'https://example.com/telegram-webhook',
   });
   ```

2. **生产级特性**
   - 请求体限制 (1MB)
   - 超时保护 (30s)
   - 健康检查 (`/healthz`)
   - Secret token 验证

3. **双模式支持**
   - Polling 模式 (默认)
   - Webhook 模式 (预留)
   - 自动清理资源

## 技术亮点

### 1. 插件化架构
```typescript
interface ChannelPlugin {
  id: ChannelType;
  meta: ChannelMetadata;
  init(options: ChannelInitOptions): Promise<void>;
  start(options?: ChannelStartOptions): Promise<void>;
  stop(accountId?: string): Promise<void>;
  send(options: ChannelSendOptions): Promise<ChannelSendResult>;
  startStream(options: ChannelSendStreamOptions): ChannelStreamHandle;
  getStatus(accountId?: string): ChannelStatus;
  testConnection(): Promise<{ success: boolean; error?: string }>;
}
```

### 2. 分层访问控制
```typescript
// 基础访问控制
evaluateGroupBaseAccess({
  isGroup,
  groupConfig,
  topicConfig,
  effectiveGroupAllow,
});

// 策略访问控制
evaluateGroupPolicyAccess({
  isGroup,
  groupPolicy,
  effectiveGroupAllow,
});
```

### 3. 流式处理
```typescript
class DraftStreamManager {
  getOrCreate(key: string, options): TelegramDraftStream;
  stop(key: string): Promise<void>;
  stopAll(): Promise<void>;
}

interface TelegramDraftStream {
  update: (text: string) => void;
  flush: () => Promise<void>;
  clear: () => Promise<void>;
  stop: () => void;
  messageId: () => number | undefined;
}
```

## 性能优化

1. **并发处理**
   - 使用 `@grammyjs/runner` 并发处理更新
   - 支持多账户并行运行

2. **缓存优化**
   - Update offset 内存缓存
   - 减少磁盘 I/O 频率

3. **API 限流保护**
   - 流式预览节流 (1s)
   - 消息长度限制 (4096 字符)

## 向后兼容性

- ✅ 保留 `TelegramChannel` 类 (legacy 模式)
- ✅ 支持旧配置格式 (token, allowFrom)
- ✅ `ChannelManager` 同时支持两种模式
- ✅ 渐进式迁移路径

## 使用示例

### 基础使用 (Legacy)
```typescript
import { ChannelManager } from './channels/manager.js';

const manager = new ChannelManager(config, bus);
await manager.startAll();
```

### 多账户 (Plugin)
```typescript
import { telegramPlugin } from './channels/index.js';

await telegramPlugin.init({ bus, config, channelConfig });
await telegramPlugin.start();

// 发送消息
await telegramPlugin.send({
  chatId: '123456',
  content: 'Hello',
  accountId: 'personal',
});

// 流式发送
const stream = telegramPlugin.startStream({ chatId: '123456' });
stream.update('Processing...');
stream.update('Still working...');
await stream.end();
```

### 配置多账户
```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "token": "TOKEN_1",
          "allowFrom": [123456, 789012],
          "dmPolicy": "allowlist"
        },
        "work": {
          "name": "Work Bot",
          "token": "TOKEN_2",
          "groups": {
            "-1001234567890": {
              "requireMention": true,
              "systemPrompt": "You are a work assistant",
              "topics": {
                "100": {
                  "systemPrompt": "Code review topic"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## 测试建议

1. **单元测试**
   - `access-control.test.ts` - 访问控制逻辑
   - `format.test.ts` - HTML 格式化
   - `draft-stream.test.ts` - 流式预览

2. **集成测试**
   - 多账户并发处理
   - Update offset 持久化
   - Webhook 端到端

3. **性能测试**
   - 高并发消息处理
   - 流式预览节流效果
   - 内存缓存命中率

## 后续优化

1. **Webhook 生产部署**
   - 集成到 gateway 统一管理
   - 支持动态配置 webhook URL
   - 添加 webhook 日志和监控

2. **高级功能**
   - 支持 Telegram reactions
   - 支持 poll 创建和投票
   - 支持 inline buttons

3. **监控和诊断**
   - 添加 diagnostic flags
   - 实现 channel 健康检查
   - 添加性能指标收集

## 参考

- [openclaw Telegram Channel](https://github.com/openclaw/openclaw/tree/main/src/telegram)
- [grammY Documentation](https://grammy.dev/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

---

**重构完成时间:** 2026-02-21  
**重构分支:** `refactor/telegram-channel-architecture`  
**提交数量:** 3 (P0, P1, P2)  
**新增代码:** ~2000 行  
**测试状态:** 构建通过 ✅
