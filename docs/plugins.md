# xopcbot 插件系统

xopcbot 提供了一个轻量级但功能强大的插件系统，灵感来自 [OpenClaw](https://github.com/openclaw/openclaw)。

## 快速开始

### 安装插件

```bash
# 从 npm 安装
npm install xopcbot-plugin-hello

# 或从本地路径安装
cd ~/.xopcbot/plugins
git clone https://github.com/your/plugin.git
```

### 启用插件

在 `~/.xopcbot/config.json` 中配置：

```json
{
  "plugins": {
    "enabled": ["hello", "echo"]
  }
}
```

### 使用插件工具

```
/hello World
```

## 插件结构

### Manifest 文件

每个插件必须包含一个 `xopcbot.plugin.json` 文件：

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "A description of my plugin",
  "version": "1.0.0",
  "main": "index.js",
  "configSchema": {
    "type": "object",
    "properties": {
      "option1": {
        "type": "string",
        "default": "value"
      }
    }
  }
}
```

### 插件入口文件

```javascript
// index.js
import type { PluginApi } from 'xopcbot-plugin-sdk';

const plugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  description: 'Description here',
  version: '1.0.0',

  // 插件注册时调用
  register(api: PluginApi) {
    // 注册工具
    api.registerTool({...});
    
    // 注册命令
    api.registerCommand({...});
    
    // 注册钩子
    api.registerHook('message_received', async (event, ctx) => {...});
    
    // 注册 HTTP 路由
    api.registerHttpRoute('/my-route', async (req, res) => {...});
  },

  // 插件启用时调用
  activate(api: PluginApi) {
    console.log('Plugin activated');
  },

  // 插件禁用时调用
  deactivate(api: PluginApi) {
    console.log('Plugin deactivated');
  },
};

export default plugin;
```

## 核心概念

### 工具 (Tools)

插件可以注册自定义工具供 Agent 使用：

```javascript
api.registerTool({
  name: 'my_tool',
  description: 'Do something useful',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input value' }
    },
    required: ['input']
  },
  async execute(params) {
    const input = params.input;
    // 执行操作
    return `Result: ${input}`;
  }
});
```

### 钩子 (Hooks)

钩子允许插件在各个生命周期点拦截和修改行为：

| 钩子 | 时机 | 用途 |
|------|------|------|
| `before_agent_start` | Agent 启动前 | 修改系统提示 |
| `agent_end` | Agent 完成后 | 后处理结果 |
| `message_received` | 收到消息时 | 消息预处理 |
| `message_sending` | 发送消息前 | 修改消息内容 |
| `message_sent` | 消息发送后 | 发送日志 |
| `before_tool_call` | 工具调用前 | 参数验证 |
| `after_tool_call` | 工具调用后 | 结果处理 |
| `session_start` | 会话开始 | 初始化 |
| `session_end` | 会话结束 | 清理 |
| `gateway_start` | 网关启动 | 配置 |
| `gateway_stop` | 网关关闭 | 清理 |

```javascript
// 修改消息发送
api.registerHook('message_sending', async (event, ctx) => {
  const message = event;
  if (message.content.startsWith('[private]')) {
    message.content = message.content.replace('[private]', '').trim();
    return { content: message.content };
  }
});

// 阻止特定工具调用
api.registerHook('before_tool_call', async (event, ctx) => {
  const toolCall = event;
  if (toolCall.toolName === 'delete_file') {
    return { block: true, blockReason: 'File deletion is disabled' };
  }
});
```

### 命令 (Commands)

注册自定义命令：

```javascript
api.registerCommand({
  name: 'status',
  description: 'Check plugin status',
  acceptArgs: false,
  requireAuth: true,
  handler: async (args, ctx) => {
    return {
      content: 'Plugin is running!',
      success: true
    };
  }
});
```

### HTTP 路由

```javascript
api.registerHttpRoute('/my-plugin/status', async (req, res) => {
  res.json({ status: 'running', plugin: 'my-plugin' });
});
```

### 网关方法

```javascript
api.registerGatewayMethod('my-plugin.status', async (params) => {
  return { status: 'running' };
});
```

### 后台服务

```javascript
api.registerService({
  id: 'my-service',
  start(context) {
    // 启动后台任务
    this.interval = setInterval(() => {
      // 定时任务
    }, 60000);
  },
  stop(context) {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }
});
```

## 配置管理

### 定义配置模式

```json
{
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "string",
        "description": "API Key for the service"
      },
      "maxResults": {
        "type": "number",
        "default": 10
      }
    },
    "required": ["apiKey"]
  }
}
```

### 访问配置

```javascript
const apiKey = api.pluginConfig.apiKey;
const maxResults = api.pluginConfig.maxResults || 10;
```

## 日志记录

```javascript
api.logger.debug('Detailed debug information');
api.logger.info('General information');
api.logger.warn('Warning message');
api.logger.error('Error message');
```

## 路径解析

```javascript
// 解析工作区路径
const configPath = api.resolvePath('config.json');

// 解析插件相对路径
const dataPath = api.resolvePath('./data.json');
```

## 事件系统

```javascript
// 发送事件
api.emit('my-event', { key: 'value' });

// 监听事件
api.on('other-event', (data) => {
  console.log('Received:', data);
});

// 移除监听器
api.off('my-event', handler);
```

## 完整示例

```javascript
import type { PluginApi } from 'xopcbot-plugin-sdk';

const plugin = {
  id: 'example',
  name: 'Example Plugin',
  description: 'A complete example plugin',
  version: '1.0.0',
  configSchema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true }
    }
  },

  register(api) {
    // Register tool
    api.registerTool({
      name: 'example_tool',
      description: 'Example tool',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input']
      },
      async execute(params) {
        return `Processed: ${params.input}`;
      }
    });

    // Register hook
    api.registerHook('message_received', async (event) => {
      console.log('Received:', event.content);
    });

    // Register command
    api.registerCommand({
      name: 'example',
      description: 'Example command',
      handler: async (args) => {
        return { content: 'Example!', success: true };
      }
    });
  },

  activate(api) {
    console.log('Plugin activated');
  },

  deactivate(api) {
    console.log('Plugin deactivated');
  }
};

export default plugin;
```

## 发布插件

1. 创建 `xopcbot.plugin.json` manifest
2. 创建 `index.js` 入口文件
3. 推送到 GitHub 或发布到 npm

```bash
# 发布到 npm
npm publish
```

## 最佳实践

1. **错误处理**：所有异步操作都应使用 try/catch
2. **日志记录**：使用 API 的日志系统而非 console
3. **资源清理**：在 `deactivate` 中释放资源
4. **配置验证**：使用 JSON Schema 验证配置
5. **版本管理**：遵循语义化版本

## 相关链接

- [插件示例](examples/)
- [API 参考](./api.md)
- [钩子参考](./hooks.md)
