# 鸿蒙 USB 实时投屏与人工接管

日期：2026-10-30（Asia/Shanghai）。使用说明见 [Phone Use](../../zh/phone-use.md#鸿蒙-usb-真机)。

## 实现

`HdcVideoProvider` 将本机完整 HOScrcpy 库提供的 Annex-B H.264 数据接入现有 `PhoneInteractiveSession` 和 `PhoneStreamGateway`。小型 Java 桥通过私有 stdin/stdout 管道运行，不向浏览器开放端口，不接受任意 shell 输入，不采集音频或剪贴板。厂商库由用户本机提供，不进入 npm/Electron 包，也不在运行时自动下载。桥接源码以 TypeScript 字符串随 Node 构建输出，使用 JDK 17+ 临时编译，进程结束后清理编译目录。

宿主读取有界二进制消息，分离 SPS/PPS、识别关键帧、生成编码几何版本。保留现有 Gateway 的单次票据、来源校验、设备权限、应用范围、查看者数量和输入队列限制。浏览器复用已有 WebCodecs 画布和截图回退；首次连接原生编码器允许最多 35 秒启动。查看/控制连接切换时保留编码器 1.5 秒，无查看者后关闭。

人工输入按完整手势执行：按下/移动只建立待执行手势，释放后重新核对前台应用、截图尺寸、旋转和编码几何版本，再派发 UiTest 点击、长按或滑动。浏览器携带实际手势时长，避免把 HDC 观察开销误算为长按。取消、控制权撤销和配置变化丢弃未执行手势；已派发输入完成后才关闭其传输。手势不是持续触摸注入，不支持按住拖动时同步移动原生触点。文字输入仍在手机端完成。

SDK 进程关闭时清理其明确报告的 HDC forward 分配，不扫描删除其他新建连接；检测到已有原生调试/投屏 forward 时拒绝抢占。SDK 自身管理的设备端调试辅助库保持由 SDK 管理。

## 本机依赖兼容性

本机 DevEco 的 `hosScrcpy-1.0.20-beta.jar` 中，20 个 obfuscated class 的归档路径与类声明大小写不一致，例如 `com/a/a/a/g.class` 实际声明 `com.a.a.a.G`，同时缺少其他被引用类。普通 Java 类加载器不能运行该库。桥接程序在启动采集前检查相关 class 条目，发现问题返回 `PHONE_HDC_VIDEO_DEPENDENCY`，手机面板回退截图。没有修改安装中的 DevEco，也没有修改厂商库。

真机验收使用完整独立的 HOScrcpy 1.0.18-beta JAR，通过 `phone.hdcVideo.sdkJar` 指定；测试副本来自 npm 发布包 `@nszzj/dsh-hos-scrcpy@3.0.2`，下载包的 registry integrity 已核对。JAR SHA-256 为 `2ce60b1893cc2be471a8cd7eab7e4127e41921f1f89a32a134c730ba15c8c0fd`。该副本仅作临时兼容性验证，没有加入仓库、安装到生产状态或作为默认下载源。

## 验证

运行 `scripts/verify-phone-hdc-video.mts --input --browser`，在独立内存数据库、临时 workspace 和随机 token 下，通过真实 Gateway HTTP 懒路由、WebSocket 和 USB 手机验证：

- 未鉴权请求返回 401，视频经一次性票据进入现有流通道。
- 收到 608×1344、`avc1.64002a` 原生视频；Chrome WebCodecs 实际解码 4 帧。
- 同一视频源下接管、取消待执行手势；取消未产生手机动作。
- 打开设置，释放一次标题区域点击并验证人工动作计数，然后返回。
- 交还后拒绝旧控制权的 WebSocket 输入，动作数没有增加。
- 模型请求数为 0，屏幕像素只在测试进程与临时浏览器内存中使用。
- 视频进行中仍可完成原生 UI/截图观察；观察后视频继续出帧。
- 关闭后 HDC forward 列表为空。

相关回归：64 个测试文件，765 项通过、1 项跳过；后端类型检查、Web 构建和修改的手机文件 lint 通过。全量 Web lint 的两处失败位于并行变化的电脑控制文件，没有在本次修改中处理。后续版本变动需要重新执行真机验收，不能把当前结果解释为所有鸿蒙/DevEco 版本兼容。
