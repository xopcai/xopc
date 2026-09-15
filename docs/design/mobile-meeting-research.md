# 移动录音与会议助手：竞品及平台研究

日期：2026-09-15 · 代码基线：`37368b509` · 状态：公开资料研究完成；竞品与 xopc 真机实验待执行。

交付：[移动 PRD](./mobile-meeting-prd.md) · [技术设计与验收](./mobile-meeting-technical-design.md)。本轮只设计，未实现移动会议录音。

## 1. 结论

移动端应定位为“随身录音笔记”：先可靠保存现场声音，再把重点、证据和行动交给用户。PC 与手机共享会议资料和理解能力，但采集方式、生命周期和交互需要分开设计。

推荐主线：现场会议 / 访谈 / 灵感 → 一键录音 → 锁屏继续、本地分块保存 → 标记重点 → 结束即可离开 → 摘要与证据 → 确认待办。手机上的第三方线上会议优先采用平台授权资料或用户导入；不能把桌面系统声音能力照搬为手机通话录音承诺。

“顶级”不按功能数量评价。我们应在启动摩擦、录音可靠性、结论可信度、单手操作和会后行动五个维度设验收门槛，见 PRD。

## 2. 研究方法与证据边界

- 检索钉钉、飞书、豆包官方产品页、官方教程、发布说明、隐私说明；平台限制使用 Apple、Android 和 Expo 56 文档。
- **已查证**表示官方资料明确写到；不表示本轮在 iOS / Android App 上操作过。**设计推导**是我们做出的产品选择。
- 公开产品介绍不能证明所有套餐、租户、地区和手机平台均具备相同能力。没有资料不等于竞品没有功能。
- 飞书的手机操作描述可以核对；钉钉中国站部分页面只有搜索索引能取到内容，正文依赖动态加载；豆包手机商店介绍没有检索到录音操作细节。这些地方保留证据缺口，不补造页面和点击次数。
- 排除仿冒飞书域名、无来源转载，以及钉钉 `qidian/page-*` 中注明由模型生成的内容。准确率、节省时间、语言数量等宣传数字不作为实测比较。

## 3. 三款产品：查证事实与取舍

### 3.1 飞书：从录音到可协作的会议资料

官网教程明确给出手机路径：搜索妙记 → 麦克风开始 → 实时转写、选语言 → 返回后成为应用内浮窗 → 暂停 / 继续 → 停止上传；可邀请协作者查看实时文字。教程将音频下载说明放在桌面端，不能据此宣称手机也可下载。[飞书官方教程，2025-12-01](https://www.feishu.cn/content/article/7578773484596153570)

**设计启示：**录音必须脱离页面存活；长材料需要可回到原声的阅读入口。xopc 应减少“先找工作台应用”的启动成本，录音默认私人，协作在内容确认后显式开启。浮窗采用应用内状态条，不要求 Android 悬浮窗权限。

**待实测：**当前中国版 iOS / Android 的入口是否变化；后台和断网时转写如何提示；强杀后文件恢复；移动编辑、导出、分享权限及付费边界。上述官方教程没有回答这些问题。

### 3.2 钉钉：录音内容进入办公流程

中国站可检索到 AI 听记和闪记产品页，产品命名、入口以当前客户端为准。[中国站 AI 听记](https://page.dingtalk.com/wow/dingtalk/default/dingtalk/6fgfgRdrjAFXuPAf5ymIF) · [闪记产品页](https://page.dingtalk.com/wow/dingtalk/default/dingtalk/czWaaDTBTVh4XklaQFXW)

可读取的国际站产品页明确介绍逐字转写、说话人区分、章节、行动提取和场景模板。这是**国际版产品级证据**，不能证明中国版手机上的具体交互或后台能力。[DingTalk AI Minutes](https://www.dingtalk.io/products/ai-minutes/)

**设计启示：**不能停留在生成一篇纪要；行动要能进入已有任务体系。xopc 的负责人和日期必须有依据或由用户补全，确认后再创建 Task；模板在会后选择，避免录前填表。提取出任务不等于允许自动发送消息或指派同事。

**待实测：**中国版 AI 听记 / 闪记在个人和组织账号中的关系、手机快捷入口、标记、后台通知、来电恢复、纪要转待办的确认流程。公开资料不足以给这几项打分。

### 3.3 豆包：录音成为可继续使用的个人资料

官方隐私说明明确提到移动录音转写的可选位置权限，以及录音纪要、原始文字和音频进入云盘；说话人区分描述为录音内的声学特征聚类。文中“系统音频与麦克风”是跨产品说明，不能推出 iPhone 能录任意其他 App 的通话。[豆包隐私说明，录音转写条目；本次使用搜索索引，正文抓取失败](https://www.doubao.com/legal/privacy)

桌面 App 的发布历史明确提到手机版录音纪要同步云盘；它只辅助证明跨端资料流，不作为手机 UI 的证据。[豆包桌面发布历史](https://apps.apple.com/cn/app/id6683305962?mt=12)；另核对了 [iPhone / iPad 官方商店页](https://apps.apple.com/cn/app/id6459478672)，未找到足够细的录音交互说明。

**设计启示：**声音、笔记、总结和追问应属于同一份资料。xopc 复用 Note 与 Discussion，不额外增加“录音云盘”。位置和场景识别不是开录前提；个人追问也不应自动成为共享纪要。

**待实测：**手机具体入口、会中追问是否可用、锁屏控件、离线首录、单次时长和额度耗尽后的保存行为。不能把豆包语音通话 / 同传当成录音纪要功能。

### 3.4 横向判断

以下是基于上述证据的设计判断，不是实机排行榜。

| 维度 | 飞书 | 钉钉 | 豆包 | xopc 目标 |
|---|---|---|---|---|
| 已证实的侧重点 | 手机采集到协作资料的路径 | 结构化会议产物与场景模板 | 个人录音资料集中保存 | 随手捕获、可信理解、行动落地 |
| 可借鉴 | 收起录音后继续使用应用 | 行动和办公流程衔接 | 同一资料继续使用 | 将三者融入现有笔记 / 任务 |
| 不照搬的设计选择 | 不将工作台作为必要入口 | 不在录前要求填组织表单 | 不让网络处理成为保存前提 | 本地优先，设置逐步出现 |
| 关键证据缺口 | 异常恢复与平台细节 | 中国版手机实际流程 | 手机录音完整流程 | 当前还没有长会议原生录音 |

## 4. 平台研究：哪些能力可以承诺

| 问题 | 官方依据与结论 | 产品决定 |
|---|---|---|
| iOS 锁屏继续录音 | `record` 配合 `UIBackgroundModes=audio` 可后台录音，但电话、闹钟等仍可中断。[Apple record](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/record) | 前台用户开录后支持后台；来电缺口显式记录 |
| 中断后恢复 | 必须处理音频会话中断及恢复条件。[Apple interruptions](https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions) | 初版由用户恢复；不能把 App 回到前台等同于仍在录音 |
| Android 后台麦克风 | microphone 前台服务需要相应声明和录音权限；启动受 while-in-use 限制。[FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types) · [后台启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) | 用户在前台启动；原生服务持有采集，通知可返回和停止 |
| Android 其他 App 声音 | Playback Capture 要用户授权、同一 profile、目标允许采集，且内容 usage 限于 media/game/unknown。[Android capture](https://developer.android.com/media/platform/av-capture) | 可做独立实验，不能作为通用会议 / 电话录音方案 |
| iOS 系统声音 | ReplayKit 涉及 App 音频、麦克风和屏幕录制；另有广播扩展及系统授权。[ReplayKit](https://developer.apple.com/documentation/ReplayKit) · [安全机制](https://support.apple.com/en-gb/guide/security/seca5fc039dd/web) | 没有依据承诺任意第三方会议或电话双向音频；首版不提供该入口 |
| 抢占麦克风 | Android 对并发音频输入有优先级和静音规则。[Sharing audio input](https://developer.android.com/media/platform/sharing-audio-input) | 收到帧不等于收到了会议声音；单独监控录音来源和健康 |
| Expo 是否够用 | SDK 56 支持后台录音配置；默认缓存文件可能被清理。[Expo 56 Audio](https://docs.expo.dev/versions/v56.0.0/sdk/audio/) | 普通录音可以使用，但开关不能替代原生分块、恢复日志和后台状态管理 |
| 后台上传 | iOS background URLSession 支持文件上传，调度不等于实时持续联网。[Apple background transfers](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background) | 录音与上传解耦；第一阶段恢复前台后补传即可 |

平台公开能力也需要签名包真机验证。系统录音 App 的特权、厂商电话录音、外接录音硬件不属于普通第三方 App 的通用 API 能力。外放再用麦克风采集受回声和环境影响，不包装为高质量双路采集。

## 5. 当前代码与产品距离

| 已核对位置 | 当前事实 | 设计影响 |
|---|---|---|
| `apps/mobile-expo/src/features/chat/voiceRecording.ts` | 短语音最长 8 分钟，围绕附件体积约束 | 长会议不能只调高时间常量 |
| `apps/mobile-expo/src/features/notes/use-voice-capture-interaction.tsx` | 复用短录音；组件卸载会清理当前录音 | 会议生命周期必须属于原生会话 |
| `apps/mobile-expo/src/features/voice/native-audio-session.ts` | XopcVoice PCM 通过事件送入 JS；已有占用和中断处理 | 复用权限 / 协调，但持久声音不能逐帧经过 JS |
| `apps/mobile-expo/modules/xopc-voice/` | iOS 使用 voiceChat；Android 有 VOICE_COMMUNICATION 和 MIC 路径；已有通话服务 | 近讲通话策略不应直接用于远场会议 |
| `VoiceCallService.kt` | wake lock 单次一小时超时，stop 回调在进程内 | 长录音需独立检验生命周期，不能宣布两小时已可靠 |
| `apps/mobile-expo/app.json` | 配置后台播放及现有 widgets | 不把播放器 / Live Activity 配置当作会议录音已可用 |
| `src/gateway/hono/routes/discussions.ts` | 异步 seal/job 已有；创建来源只有 web/electron；块路径仍是单 sequence | 增加 mobile 来源、离线绑定与统一 track/epoch 契约 |

旧的 [移动语音 PRD](./mobile-voice-prd.md) 解决听写和 AI 通话。新方案保留这些独立用户意图；共享权限与设备占用，不混用按钮含义。

## 6. 下一轮竞品真机实验脚本

每款产品分别测试中国版 iPhone、Android；记录 App 版本、OS、机型、账号类型、套餐、区域、时间。使用获得参与者同意的相同脚本，不录私人会议。

1. 从冷启动和首页开始录音，记录点击次数、首帧耗时、权限路径和退出后的可见状态。
2. 统一 30 分钟素材：安静双人、远场、中文夹英文、专有名词、重叠讲话、明确 / 否定 / 修改后的截止日。
3. 10 分钟时断网，锁屏 15 分钟，切网恢复；分别检验本地播放、转写水位和保存提示。
4. 接电话、拒接电话、蓝牙拔插、低电量、强制终止后重启；录下最后可恢复时间，不将通知仍在视为录音正常。
5. 标记重点、停止、摘要、证据定位、提问“最终截止日是什么”、更正说话人、创建任务、分享后撤权。
6. 输出带时间戳的屏幕记录、恢复音频时长和结果表。未知项保持未知；记录权限 / 会员阻断，不凭第三方教程补全。

这轮公开研究足以形成架构和 PRD，但还不能宣称体验全面超过上述产品。真机对照用于调整布局和指标，不用于推翻录音可靠性与系统权限边界。
