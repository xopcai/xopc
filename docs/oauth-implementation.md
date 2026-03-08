# OAuth 登录功能实现文档

## 当前状态 (2026-02-26)

### 后端 ✅
- ✅ OAuth Provider 接口（`src/auth/oauth/`）
- ✅ CLI 命令行 OAuth 登录（`xopcbot auth login`）
- ✅ HTTP API 供前端调用（`src/gateway/hono/oauth.ts`）
- ✅ OAuth 凭证持久化到配置文件

### 前端 ✅
- ✅ UI 显示 OAuth Provider 选项
- ✅ 点击 OAuth Provider 触发 OAuth 登录流程

---

## API 端点

### POST /api/auth/oauth/start
启动 OAuth 流程

```json
// Request
{ "provider": "kimi" }

// Response
{
  "ok": true,
  "payload": {
    "success": true,
    "provider": "kimi",
    "expires": 1234567890,
    "authUrl": "https://...",
    "deviceCode": "ABCD-1234",
    "instructions": "Please visit ..."
  }
}
```

### GET /api/auth/oauth/:provider
检查 OAuth 状态

```json
// Response
{
  "ok": true,
  "payload": {
    "configured": true,
    "expires": 1234567890
  }
}
```

### DELETE /api/auth/oauth/:provider
撤销 OAuth 凭证

```json
// Response
{ "ok": true }
```

### GET /api/auth/oauth
列出可用 OAuth Provider

```json
// Response
{
  "ok": true,
  "payload": {
    "providers": [
      { "id": "kimi", "name": "Kimi" },
      { "id": "anthropic", "name": "Anthropic" }
    ]
  }
}
```

---

## 支持的 OAuth Provider

| Provider | OAuth Flow | 实现方式 | 状态 |
|----------|------------|----------|------|
| kimi | Device Code | 手动实现 | ✅ |
| qwen | Device Code | 手动实现 | ✅ |
| minimax | Device Code | 手动实现 | ✅ |
| minimax-cn | Device Code | 手动实现 | ✅ |
| anthropic | Device Code | 手动实现 | ✅ |
| github-copilot | Device Code | pi-ai | ✅ |
| google-gemini-cli | Authorization Code | pi-ai | ✅ |
| google-antigravity | Device Code | pi-ai | ✅ |
| openai-codex | Device Code | pi-ai | ✅ |

---

## 凭证持久化

### Config Schema 扩展
在 `ModelProviderSchema` 中添加了 `oauth` 字段：

```typescript
oauth: {
  access: string;      // OAuth access token
  refresh?: string;    // OAuth refresh token
  expires: number;     // 过期时间戳
}
```

### 存储位置
OAuth 凭证存储在 `config.yaml` 的 `models.providers.{providerId}.oauth` 字段。

### 生命周期
1. 用户点击 OAuth Provider → 触发 `/api/auth/oauth/start`
2. 完成 OAuth 流程 → 凭证保存到配置文件
3. 服务重启 → 从配置文件加载到内存缓存
4. 用户撤销 → 从配置文件删除

---

## 文件结构

### 后端
```
src/
├── auth/oauth/
│   ├── index.ts          # 导出所有 OAuth Provider
│   ├── types.ts          # OAuth 接口定义
│   ├── kimi.ts           # Kimi OAuth 实现
│   ├── qwen.ts           # Qwen OAuth 实现
│   ├── minimax.ts        # MiniMax OAuth 实现
│   └── ...
└── gateway/hono/
    └── oauth.ts           # OAuth HTTP 处理
```

### 前端
```
ui/src/
├── config/
│   ├── provider-templates.ts    # OAuth Provider 模板
│   └── dynamic-providers.ts     # 动态加载 Provider
└── pages/
    └── SettingsPage.ts          # OAuth 登录触发
```

---

## 前端 Provider 映射

前端 `provider-templates.ts` 中的 `oauthProviderId` 需要与后端 OAuth Provider ID 对应：

| 前端 oauthProviderId | 后端 Provider ID |
|---------------------|------------------|
| kimi-coding | kimi |
| minimax-portal | minimax |
| minimax-cn | minimax-cn |
| alibaba-cloud | qwen |

---

## 待完成

- [ ] OAuth Token 自动刷新（当前需要用户重新登录）
- [ ] OAuth 状态 UI 优化（显示过期时间等）
- [ ] 测试各 Provider OAuth 流程
