# XOPC Cloud onboarding 真实账号验收

验证时间：2026-10-15 19:27:28–2026-10-15 19:29:18（Asia/Shanghai）。

结果：13/13 项通过。使用真实 Cloud 目录与服务，不使用模型或语音服务 mock。

## 验证方式

复用本机真实账号的登录状态。原访问令牌过期，先通过项目的 ProviderAuthService 正常刷新一次；随后仅将访问令牌写入独立临时凭据目录，不复制刷新令牌。新建独立 SQLite、工作空间和配置，从安装初始化开始，调用生产 onboarding 的能力补齐函数，再通过完整 GatewayServer 和真实 React 语音组件验证。

没有重新操作浏览器 OAuth 授权页面，没有启动 Electron 原生外壳，也没有人工监听扬声器。网页与桌面共享的 Gateway 配置逻辑经过真实目录验证，CLI 使用生产 setPrimaryModel 路径比较配置结果；浏览器使用合成麦克风输入并检查播放缓冲非零及 AudioContext 运行状态。原始模型/语音配置未改动，隔离验证期间原配置文件和凭据文件指纹一致。临时数据库、音频、凭据与浏览器测试文件已清理。

## 结果

| 检查 | 结果 |
| --- | --- |
| 首次自动配置 | chat/vision=`xopc-cloud/auto`，image=`xopc-cloud/image`；STT/TTS 及实时听写、Agent 通话、自然通话已配置并启用 |
| 重复执行 | 配置与 Agent 默认值不变 |
| CLI 一致性 | CLI 与 Gateway 生成的媒体、语音与模型配置一致 |
| 已有明确设置 | 自选聊天/图片模型、关闭的 STT/TTS/实时语音、自选音色均保留；落盘后重新读取仍一致 |
| Gateway 鉴权与就绪 | 未授权请求 401；授权后听写、Agent 通话、自然通话均可用 |
| 聊天 | 真实返回 `CLOUD_ONBOARDING_OK` |
| 图片 | 实际生成图片，并由自动配置的视觉模型描述颜色和形状 |
| 语音合成 | 返回 Cloud 音频，响应提供商确认为 `xopc-cloud` |
| 语音识别 | 真实识别“你好，请只回答语音测试成功。”，提供商确认为 `xopc-cloud` |
| Agent 通话 | STT → Agent → TTS 完成，返回“语音测试成功。”与非零 PCM |
| 自然通话 | Cloud realtime 完成识别与回复，返回“语音测试成功”与非零 PCM |
| React 浏览器 | 真实采集、上传、识别、回复及运行中的音频播放缓冲通过 |

逐项耗时、模型目录及返回证据见 [JSON 报告](./cloud-onboarding-live-2026-10-15.json)。

## 本轮发现与修复

首次真实自然通话出现 `OMNI_CONNECTION_CLOSED`。直接连接 Cloud 服务进一步观察到 WebSocket 101 后以 1011 / `client_protocol_error` 关闭。Cloud 当前协议仅接受自动生成回复的 `create_response: true`，且不接受客户端 `response.create`；客户端原先发送了 `create_response: false`。

修复 `src/voice/realtime/omniEngine.ts`：Cloud 托管模式启用上游自动回复，停止发送不支持的 `response.create`，保留本地轮次确认、播放控制和回复开始超时。直连服务原有显式创建回复逻辑保持不变。修复后真实自然通话完整往返通过。

同步扩展语音探针以支持 `assistant` / `natural`，并在新验收脚本中使用完整 GatewayServer，确保覆盖实际 WebSocket 升级。

## 回归与复现

相关回归：225 项通过，1 项跳过；TypeScript 与修改源码的 ESLint 检查通过。

```bash
XOPC_CLOUD_ONBOARDING_LIVE=1 node --import tsx scripts/cloud-onboarding-live-smoke.mts
```

需要当前有效的真实 Cloud 访问令牌、ffmpeg 和本机 Chrome。脚本使用真实服务并生成独立临时状态，结束后保存 JSON 报告并清理临时数据。脚本不会复制或刷新用户的刷新令牌。
