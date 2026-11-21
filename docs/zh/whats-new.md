# xopc 近期变化

更新于 2026 年 11 月 21 日。本文梳理 10 月下旬以来的产品变化，发布基准为 11 月 20 日的[核心 v0.0.487 标签](https://github.com/xopcai/xopc/releases/tag/v0.0.487)和 [Android v0.0.135 发布](https://github.com/xopcai/xopc/releases/tag/mobile-android-v0.0.135)。iOS 有独立分发渠道，HarmonyOS 处于内测，请核对已安装的版本。[移动端下载](./mobile-app.md) · [更新 xopc](./update.md) · [查看核心版本差异](https://github.com/xopcai/xopc/compare/v0.0.419...v0.0.487)

## Ada 与任务交付

- 首页发现重复请求时，可以建议一份任务草稿。打开草稿，检查目标和范围再开始。持续目标支持在推进中逐步审阅下一步。[Personal AI 持续跟进](./personal-agent-proactivity.md)
- 任务卡集中展示结果、产物、检查项和剩余工作。符合自动验收条件的委派任务通过检查后，Ada 可以完成验收。想亲自确认时，交办时明确要求人工验收。支持的会话可以在执行中补充或调整方向。任务失败时，先查看记录的原因，再决定是否重试。[向 Ada 交办](./task-delegation.md) · [任务验收](./task-review.md)
- 支持的客户端会在回复后提供下一轮建议，由你决定发送什么。[聊天与会话](./session.md)

## 项目、资料库与编辑

- 项目预览集中展示任务与进展，便于回到原项目继续。从项目发起自动化配置对话，可以把日程留在项目内。个人日程从 Personal 发起。[项目与任务](./projects-tasks-notes.md) · [自动化](./automations.md)
- **资料库**集中保存文件和生成结果。在网页和桌面端，可以把修改后的交付文件保存为新版本，也可以打开可编辑的工作簿，围绕指定单元格范围提问、审阅建议修改，并把已保存的版本下载为 Excel。[处理文件与项目](./workspace-guide.md)
- 网页笔记编辑器新增标题大纲。保存遇到新版冲突时，编辑器会保留草稿并提供恢复入口。[笔记](./projects-tasks-notes.md)

## 媒体与客户端

- 配置生成服务后，可以在聊天里生成音乐或视频草稿。支持的客户端可以在会话内播放结果，网页切换页面时音乐可继续播放。生成任务可能在当前回复结束后才完成，可以从结果卡查看进度和获取成品。[图像与生成媒体](./image-multimodal.md)
- 手机侧栏汇集最近对话和工作入口。支持的版本可以直接在手机上配置模型与自定义 MCP 连接。支持截图的桌面版本可以在 **设置 → 键盘快捷键** 中修改截图快捷键。[手机端](./mobile-app.md) · [桌面端](./desktop-app.md)

## 消息通道、设备与 MCP

- Slack 和 Discord 可以把机器人收到的消息交给 xopc Agent。在 **设置 → 消息通道** 中连接机器人，批准私聊配对，并指定可在公共频道调用它的成员。[Slack](./channels/slack.md) · [Discord](./channels/discord.md)
- **设备连接**显示已连接客户端及其报告的能力。外部 MCP 客户端可以通过 Gateway 授权搜索工作区记录或向 xopc Agent 委派任务。Gateway 提供本地 stdio，也可以配置带 OAuth 的远程 Streamable HTTP。[设备连接](./desktop-app.md#查看已连接设备) · [MCP 配置与 Gateway 访问](./mcp.md)

## 11 月 20 日发布标签之后的变化

当前源码为 Android、iOS 和 HarmonyOS 增加全局笔记、移动端笔记草稿恢复和更多会话操作。新建普通项目聊天默认使用项目配置的目录，委派实现任务仍可使用由 xopc 管理的 Git worktree。Gateway MCP 回调的启动修复也在 v0.0.487 之后合入。请核对安装版本是否包含这些变化。[手机端](./mobile-app.md) · [项目聊天环境](./session.md#模型与项目执行环境)

## 从 10 月版本升级

浏览器流程录制、保存和重放已于 11 月 3 日移除，浏览器控制仍可使用。电脑控制在 macOS 和 Windows x64 桌面端提供预览。Android 手机还可使用独立的手机控制预览，Android 11 及以上支持局域网配对。[浏览器扩展](./browser-extension.md) · [电脑控制](./computer-use.md) · [手机控制](./phone-use.md)

查看发布说明，分别更新使用中的 Gateway 和客户端，然后验证一次模型调用及常用连接。[GitHub Releases](https://github.com/xopcai/xopc/releases) · [升级与恢复](./update.md)
