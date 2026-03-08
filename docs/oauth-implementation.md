# OAuth 登录功能实现文档

## 当前状态

### 后端
- ✅ 已实现 OAuth Provider 接口（`src/auth/oauth/`）
- ✅ CLI 命令行 OAuth 登录（`xopcbot auth login`）
- ❌ 缺少 HTTP API 供前端调用

### 前端
- ✅ UI 显示 OAuth Provider 选项
- ❌ 点击 OAuth Provider 提示 "Phase 2"

## 实现方案

### 1. 后端新增 OAuth API

需要创建以下 HTTP 端点：

```
POST /api/auth/oauth/start
  - body: { provider: "kimi" | "qwen" | "minimax" }
  - response: { authUrl: string, deviceCode: string, interval: number }

POST /api/auth/oauth/poll
  - body: { provider: string, deviceCode: string }
  - response: { accessToken: string, refreshToken: string, expiresIn: number }

POST /api/auth/oauth/callback (可选，用于 Authorization Code Flow)
  - 处理 OAuth 回调
```

### 2. 前端实现 OAuth 流程

根据 Provider 类型选择不同流程：

#### Device Code Flow (KimI)
1. 调用 `/api/auth/oauth/start`
2. 显示设备码和验证 URL
3. 用户在浏览器授权
4. 轮询 `/api/auth/oauth/poll`
5. 获取 token 后保存到配置

#### Authorization Code Flow (Qwen, MiniMax)
1. 调用 `/api/auth/oauth/start`
2. 打开授权页面
3. 等待回调
4. 获取 token

### 3. 支持的 OAuth Provider

| Provider | OAuth Flow | 状态 |
|----------|------------|------|
| kimi | Device Code | ✅ CLI 已实现 |
| qwen | Device Code | ✅ CLI 已实现 |
| minimax | Device Code | ✅ CLI 已实现 |
| minimax-cn | Device Code | ✅ CLI 已实现 |
| anthropic | Device Code | ✅ CLI 已实现 |
| github-copilot | Device Code | ✅ CLI 已实现 |
| google-gemini-cli | Authorization Code | ✅ CLI 已实现 |

## 需要创建的文件

### 后端
- `src/gateway/hono/oauth.ts` - OAuth HTTP 处理
- 修改 `src/gateway/hono/app.ts` - 注册路由

### 前端
- `ui/src/config/oauth.ts` - OAuth 状态管理（可选）
- 修改 `ui/src/pages/SettingsPage.ts` - 实现 OAuth 流程

## 实现步骤

1. **后端 OAuth API**
   - 创建 OAuth 路由处理
   - 复用现有 `src/auth/oauth/` 中的 Provider 实现
   - 添加 token 存储

2. **前端 OAuth UI**
   - 替换 alert 为 OAuth 授权弹窗
   - 显示设备码/授权链接
   - 处理授权结果

3. **测试**
   - 各 Provider OAuth 流程测试
   - Token 刷新测试
