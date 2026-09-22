# Chat 对齐复核（2026-09-22）

范围：当前工作区 Expo（Android/iOS 共用）与 HarmonyOS Chat 源码。仅修改鸿蒙，不修改其他进行中的 Gateway/Expo 功能。源码存在不代表真机验收通过；以下是开发与验收清单，不给虚假的完成百分比。

| 场景 | Expo 基准（`src/features/chat/`） | 鸿蒙现状与剩余差异 | 顺序 |
| --- | --- | --- | --- |
| 主页面/抽屉/底部导航 | `ChatScreen`、`ChatNavigationDrawer` | 已原地切换会话，保留主导航；需新包键盘/切换回归 | 验收 |
| 输入/草稿/排队 | `composer-*`、`use-composer-attachments` | 草稿、引用、next/steer、排队编辑/取消已有；失败重试、版本冲突需隔离端到端测试 | P1 |
| 用户消息/图片解析 | `wire-text-scrub`、`wire-attachments` | 已移植模型内部文本清洗，保留结构化媒体；复杂历史附件继续同样例对照 | 回归 |
| AI/Thinking/Tool | `assistant-turn-view-model`、`AssistantStepsBlock`、`ToolUseBlock` | 有顺序块、状态、输入输出、折叠；缺完整计时/专用工具细节及同屏视觉比对 | P1 |
| Review/交付物 | `ProductDeliveryCard`、`AssistantDeliverablesCard` | review、文件可用性、权限控制、继续对话已有；真实产物打开/分享尚未全验收 | P1 |
| 历史分页/性能 | `use-session-history`、滚动几何/跟随逻辑 | 有自动分页、锚点、虚拟列表和快照重叠保留；长消息高度变化及快速切换需实测 | P0 验收 |
| 离线历史/预取 | `session-history-cache`、`session-history-prefetch` | 本轮补充有界安全首屏缓存、陈旧提示、网络覆盖和删除/重置失效；后台旧页预取、完整离线历史尚缺 | P0 验收 |
| 连续朗读 | `use-auto-read-aloud`、`ContinuousReadAloudBar` | 本轮补充会话开关、完成边沿去重、离开/录音停止；原生音频时序待验收 | P0 验收 |
| 朗读文字/语言 | `../voice/read-aloud-text` | 已对齐正文清洗、短首段和正文语言检测，并直接使用 Expo 函数做同样例断言 | 回归 |
| AI 音频自动播放 | `assistant-audio-autoplay*` | 历史音频可手动播放；缺新流音频去重队列与录音/播放统一协调 | P1 |
| 语音消息发送 | `use-chat-voice-recording` | 新增语音附件直接发送、成功清理、失败保留、短录音/重复发送/取消保护；按住滑动取消/转文字手势仍缺 | P0 验收/开发 |
| 实时语音 | `../voice/voice-call`、`voice-call-controller`、`voice-transport` | 普通 natural / 工具助手 assistant 两模式均未实现，不以录音转文字替代 | P0 下一批 |
| ＋ action 卡片 | `ChatComposer`、`composer-action-panel` | 已补统一居中图标卡片、相机/相册/本地文件、三类独立引用、新对话；暂为有界纵向滚动，尚缺横向分页/关闭动画、两类通话、会议录音入口 | P0/P1 |
| 图片编辑 | `ImageEditorModal`、`image-editing` | 选择、缩略图、原图有界解码已有；缺旋转/裁剪及发送前替换 | P1 |
| 图片浏览 | `AttachmentRenderer`、图片预览组件 | 有单图预览与按钮缩放；缺多图浏览、捏合/拖动等手势 | P1 |
| 文档预览/分享 | `AttachmentRenderer`、`FilePreviewModal`、`ShareSheet` | 本轮补齐普通附件紧凑列表与预览分流，并把 Chat/Files 的托管文件分享改为 `/api/shares/auto` 受控链接：展示公网/LAN/仅本机状态后复制或系统分享，下载保持独立；不再把临时缓存文件误当为产品分享。HTML 使用 CSP、禁 JS/存储/文件/外部跳转。分享历史/撤销/续期、二维码/站点内预览、目录确认和真机系统面板仍待后续 | P1 开发/验收 |
| Markdown | `MarkdownView`、`markdown-render-safety` | 原生子集覆盖常用块；扩展块、深链、表格/长代码/深色排版仍需逐项比对 | P1 |
| 断线恢复 | `use-agent-stream-resume`、`use-agent-stream-recovery` | 鸿蒙恢复期间按快照刷新，而非完全同等增量续流；保留最终内容已有单测，真实 WSS gap/replay 待验收 | P0/P1 |

## 开发顺序与边界

1. 连续朗读：独立纯状态转换，与会话/开关/stream 完成边沿绑定；首次打开、开关启用、翻页不朗读旧消息；已有音频不重复合成；离开页面或开始录音停止。
2. 离线历史：复用安全存储，按 Gateway+会话隔离，缓存仅做陈旧首屏种子；新网络结果优先，失败保留缓存并标注；重置/删除失效；容量有界。预取与全部历史离线另记，不偷换成已完成。
3. 按用户追加要求，优先语音发送、实时语音和 action 卡片，再继续图片编辑、受限预览、音频协调、流式恢复和消息细节。
4. 每项分别记录源码、host 测试、原生构建、设备证据。设备缺失不阻塞可独立完成的代码，但不得标记 UI 验收通过。

回滚采用局部纠正补丁或新构建，不重置用户工作区、不清空配对、不修改用户 Gateway 数据。本轮已有自主实施授权；常规接口/文件拆分按现有 MVVM 风格执行。

## 本轮验证

本轮 host 测试 304 项 / 46 文件通过；Debug、Release、ohosTest 构建通过；最后图标居中 UI 修订再次通过签名 Debug 构建（5.787 秒）并覆盖安装成功。CodeLinter 无 error，1 条安全缓存 JSON 快照深拷贝性能建议，未隐瞒或批量禁用规则。安全缓存为 8 个首屏、总计 48 KiB 上限，不是全部历史离线。

文件预览追加批次：以 Expo `AttachmentRenderer` / `FilePreviewModal` 为基准，普通文件改为紧凑资源列表，语音附件继续独立展示；支持图片、Markdown、文本、受限 HTML、音频、视频和二进制降级，保留提取文本、分享、下载、失败重试。HTML 只加载本地已获取正文，注入 `default-src 'none'` CSP，关闭 JavaScript、DOM storage、文件访问并拦截外部导航。314 项 / 47 文件通过，Debug、Release、ohosTest 均通过；CodeLinter 无新增诊断。HDC 当前无目标，设备视觉/分享验收未冒充完成。

分享语义复核发现旧实现与 Expo 不一致：鸿蒙曾把下载到手机缓存的文件 URI 直接交给系统分享，绕过 Gateway 分享的有效期、访问上限、撤销和可达性。现已改为仅针对明确的托管文件 ID、`xopc-file:` ID 或会话内相对路径调用 `/api/shares/auto`；创建后先显示分享链接和公网/LAN/仅本机状态，再提供复制链接或系统分享。Chat 预览和 Files 文件详情复用该链路，原始下载仍是独立动作。原始 `media://`、data URI 和外部 URL 不显示“创建公开分享”入口，避免误导和凭据泄漏。分享管理、笔记/会话分享、二维码/内嵌网页预览、目录分享确认和系统分享到 xopc 尚未对齐，继续列为待开发项。

设备最初无 HDC 目标，随后 Mate 60 重新连接；已使用已有本地调试签名覆盖安装成功、保留配对。解锁后 UI 树确认 Chat 和 8 个 action 卡片已渲染。截图/点击过程中手机再次锁屏，因此不能据此宣称点击跳转、真实语音发送或完整视觉验收通过。用户反馈图标未居中，已补显式居中容器。未发送测试消息、未启动录音、未接受模拟器许可。

居中修订包已再次安装并成功启动；UI 树可见主 Chat 和 composer。随后准备打开面板截图时 HDC 目标断开，居中后的最终截图与坐标验收尚未完成。

## 实时语音下一批的验收边界

- `/api/voice/realtime/status` 两模式能力检测与不可用原因；按当前会话 transcriptId 绑定，不跨 Gateway/会话复用。
- `preflight` / `sessions` / `sessions/cancel`，协议 v3、`websocket-pcm`、16 kHz 输入。已有 Expo `query/voice.ts` 是接口基准，不能只加可点击入口。
- 原生麦克风采集、PCM 播放、回声/路由、静音、扬声器、打断、背压、断线恢复、挂断资源释放；与朗读和录音互斥。
- assistant 模式的工具执行与审批提示；不在验收脚本中自动批准用户审批。
- action 面板还需两类通话卡片、会议录音页、横向分页及动画结束后单次分发。暂不提供虚假的已可用入口。
