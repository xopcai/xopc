# 移动录音实施与自查

日期：2026-09-15 · 状态：**M0 部分完成，整项需求未完成**。

关联：[技术设计](./mobile-meeting-technical-design.md) · [PRD](./mobile-meeting-prd.md)

## 1. 本批实际实现

- Swift / Kotlin `RecordingSpool`：16kHz PCM16 mono、20 秒独立 WAV、不可变 JSON 回执、SHA-256、原生文件锁、尾段恢复、已保存块完整性检查。
- 原生 `RecordingCapture` 核心：iOS AVAudioEngine 转换，Android AudioRecord MIC；原生有界队列写文件，不经 JS base64。处理音频中断 / 路由及写入错误；队列超限停止接收新数据。
- Swift 故障测试及 iPhoneOS 目标类型检查脚本；Kotlin 5 项 JUnit 文件系统测试。

这批是 M0 的底层验证代码，**尚未接入 XopcVoice 导出接口、Android 前台服务、移动 UI、上传或 Discussion**。不能在 App 内直接使用新录音功能，也不能宣称 M1 已完成。

## 2. KISS 决策

顺序音频的权威清单使用每块一个不可变 JSON 回执，无需再开 SQLite 数据库。WAV 提交前先写 pending；崩溃后按 pending 和实际完整样本恢复。生命周期和同步字段留待 M1 按同一目录、单写入者实现，未实现的字段不伪装为可用。

保留现有短语音与通话，因为它们是不同需求；没有创建旧上传接口、旧协议转接或第二套转写系统。本批没有改动原有录音用户入口。

## 3. 已完成自查和修复

| 发现 | 修复 |
|---|---|
| WAV 已 rename、回执失败后继续 append 可能覆盖待恢复材料 | 写入器进入失败状态，拒绝继续写；保留 pending，重新打开时恢复 |
| 两个客户端同时打开同一录音 | 原生 OS 文件锁拒绝第二个写入者 |
| 进程退出留下不完整 PCM 最后一个字节 | 截到完整采样帧，修复 WAV header 后提交短块 |
| 回执提交后 pending 尚未删除 | 对照已提交块验证后移除 pending，不重复添加块 |
| 已保存音频被截断 / 改写 | 启动时校验长度、header 和 SHA-256，保留损坏材料并报错 |
| iOS 队列积压时反复向主线程报错 | 原生 ingress gate 一次性停止接收并仅报告一次 |
| iOS 停止与尚在转换的回调竞争 | generation 和 ingress gate 拒绝停止后迟到写入 |
| Android stop 异常可能跳过 writer / 文件清理 | 分层 finally 清理；读线程异常进入中断路径 |
| Android 无音频帧但没有返回错误 | 超过 2 秒无帧报告错误；正常静音帧不被判失败 |
| 小块接口意外接受整场音频对象 | 限制单次 PCM 输入不超过一个片段，拒绝奇数字节与倒退 epoch |

## 4. 实际验证结果

### 已通过

- `bash scripts/apps/mobile-expo/test-recording-spool-ios.sh`：文件锁、20 秒轮换、epoch 边界、尾段修复、相同 golden hash、重复回执、已保存材料损坏、提交失败恢复、输入校验、两小时合成 PCM 恢复。
- iPhoneOS arm64 / iOS 16.4 目标：`RecordingSpool.swift` 与 `RecordingCapture.swift` 类型检查通过。16.4 是模块当前 podspec 下限，不代表整 App 的最低支持版本结论。
- Kotlin 2.1.20 独立编译（Android 36 SDK 类型），JUnit：5 项通过。两端 40ms 固定 PCM fixture 的 WAV SHA-256 一致。
- 切换到本机 JDK 17 后，项目 Gradle `:xopc-voice:testDebugUnitTest` 成功：6 个 suite、27 项测试、0 failures、0 errors，包含已有原生通话相关测试。原生模块编译通过，尚未构建 / 安装整 App 发布包。
- 两小时测试实际写入 360 个块、115,200,000 个样本，约 230.4 MB 原始 PCM；这是加速写入合成数据，**不是两小时麦克风 / 锁屏测试**。

### 已解决的构建环境问题

项目 Gradle 9.3.1 在配置阶段失败：

```text
Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field
'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'
```

最初使用 Android Studio 自带 JBR 21 重现，失败发生在本模块编译前。继续排查发现 React Native 插件需要 JDK 17，而旧 Foojay 自动下载路径与当前 Gradle 不兼容。改用本机已安装的 JDK 17 后，项目原生模块编译及 27 项测试通过；没有修改项目 Gradle / Expo 版本。

本机可复现命令（JDK 路径因设备而异）：

```sh
JAVA_HOME=/opt/homebrew/Cellar/openjdk@17/17.0.19/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME=/Users/micjoyce/Library/Android/sdk \
apps/mobile-expo/android/gradlew -p apps/mobile-expo/android :xopc-voice:testDebugUnitTest --console=plain
```

### 设备阻塞与未验证项

`devicectl list devices` 和 `adb devices -l` 均未发现连接设备。尚未执行：后台锁屏跨片段、电话打断、远场音质、蓝牙、耗电 / 热量、真实断电、系统文件保护及 Android 目录持久化行为。

此外，采集核心尚需完成服务 / 模块生命周期集成；开始时扫描历史材料和停止等待 writer 仍需改为不阻塞界面的命令路径。当前核心的同步生命周期接口仅用于 M0，不应直接从 UI 导出为生产 API。

## 5. 下一批依赖顺序

1. 接入 M0 原生验证入口，补齐设备所有者与服务生命周期，构建完整 App，再完成真机矩阵；模块构建环境已确认。
2. M1：状态 journal、原生异步命令、恢复列表、麦克风统一占用、前台服务、录音 UI；保持只有一个正式录音控制接口。
3. M1 远端：完成共用 P1-A track/epoch、mobile 来源 / 离线幂等绑定、原始块派生 ASR 与 seal 对账。
4. M2：Note / 摘要 / 证据 / Task；M3：会中问答及复盘；M4：导入与扩展。

M0 的软件测试通过不等于 M0 发布门槛通过。后续阶段尚未验收，不以当前代码数量替代完整交付。
