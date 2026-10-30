# 鸿蒙独立依赖与对话安装

HDC 下载已进一步缩小为约 6 MB 的两个文件，当前方案与验收见 [HDC 最小下载](phone-use-hdc-minimal-2026-10-30.md)。

## 用户流程

用户在原对话说「帮我配置鸿蒙手机并安装需要的依赖」。现有 configure-xopc / xopc_use phone_setup 选择 `source:harmonyos`，读取当前依赖和来源信息，使用 `install_dependency {kind:"harmonyos",setupId,expectedRevision}` 安装缺失的 HDC、Java、HOScrcpy。每个组件安装后重新检测；已就绪组件不重复安装。安装失败保留已完成组件和可续传的下载片段，重新读取配置进度后可重试。

「设置 → 手机控制 → 添加手机 → 鸿蒙」和运行环境的连接组件卡片也提供一键安装、逐项修复和进度显示。手动路径仍可选。无需安装 DevEco Studio；组件位于 Gateway 的 xopc 用户目录，不修改系统 PATH/JAVA_HOME。用户只需在准备连接时解锁手机、开启 USB 调试并授权。安装依赖本身不截屏、不启动投屏或操作手机。

## 下载来源与约束

- HDC：固定第三方 `hdw2@2.3.10` 中的 HDC 与 USB 库，按主机平台直接下载两个文件，合计约 6 MB，不下载 SDK 或 npm 整包。原 SDK 大包路线已移除。
- Java：固定 Amazon Corretto 完整 JDK，包含 java/javac；所有托管主机固定 Corretto 17.0.21.0.11。复用已有 JDK 17+，支持 JAVA_HOME、PATH、已有 DevEco 与托管目录检测。
- HOScrcpy：固定兼容 SDK 1.0.18-beta，来自第三方 npm 包 `@nszzj/dsh-hos-scrcpy@3.0.2`。仅提取原始 JAR、LICENSE 和 THIRD_PARTY_NOTICES，不运行 npm 生命周期或该包的 JavaScript。该包不是华为官方下载，SDK 的来源说明由分发者提供。

每个依赖文件或归档都有固定 SHA-256；HOScrcpy JAR 还有单独的固定哈希。下载复用现有代理、离线包、续传和大小限制；HDC 的每个文件按固定字节数限制，其他运行时保持 500 MiB 上限。离线目录使用 catalog 中的两个原始文件名，不接受任意 URL。托管安装关闭时不绕过产品策略。

支持托管 HDC 的主机为 macOS arm64/x64、Linux x64、Windows x64；Linux arm64 可复用已有 HDC，暂不提供其托管 HDC 包。跨平台矩阵由 catalog 测试覆盖，本次实际主机验收仅覆盖 macOS arm64。

来源：

- [OpenHarmony 6.0 发布说明与官方包校验值](https://github.com/openharmony/docs/blob/master/en/release-notes/OpenHarmony-v6.0-release.md)
- [HDC 使用说明](https://github.com/openharmony/docs/blob/master/en/application-dev/dfx/hdc.md)
- [Amazon Corretto 17 官方下载与 SHA-256](https://docs.aws.amazon.com/corretto/latest/corretto-17-ug/downloads-list.html)
- [HOScrcpy 分发者来源声明](https://github.com/ns-zzj/dsh-hos-scrcpy/blob/main/THIRD_PARTY_NOTICES.md)

## 实现与边界

`HarmonyDependencyManager` 复用既有下载、安装锁、归档校验及进度事件；安装先在暂存目录探测，再以备份/重命名替换目标，探测或下载失败不替换已有副本。配置写入保留版本冲突检查；对话安装继续检查原会话、授权、取消信号和 revision。安装共享组件前及提交前检查活跃手机会话。托管路径写入 phone 配置后，既有 HDC 驱动、原生投屏与手机面板直接复用。

HOScrcpy 的已知 JAR 用固定哈希验证；其他已有库通过 Java 桥的 `--probe` 分支检查归档类名、编译及 API 类加载，不创建原生采集设备。此检查短暂缓存并结合文件身份更新失效。电脑依赖就绪不等于手机连接或视频兼容性通过。

对话配置现在能发现和注册鸿蒙 USB 手机，新注册设备只允许 `com.huawei.hmos.settings`。基础验收采用鸿蒙设置中的关于本机/版本页，不要求 Android ADB，也不依赖视频；不会向鸿蒙发送 Android Settings intent。已有注册的权限不扩大，同序列号的 Android 注册不被误用。设备测试仍需用户选择并授权，依赖安装不会自行触发验收。

## 前一阶段验证记录

以下为独立依赖首次实现时的记录；HDC 当前最小下载的最新实测见上方链接。

- 最终相关回归：83 文件，807 项通过、1 项跳过，覆盖运行环境、手机、对话配置、Gateway 实际鉴权路径与 Web 手机面板。
- 后端 TypeScript、Web type-check、Web 构建与修改文件 lint 通过，`git diff --check` 通过。
- 在隔离临时状态目录从零安装三项依赖：HDC 使用已下载的真实官方 SDK 离线归档、HOScrcpy 使用真实 npm 离线归档，Java 由产品下载器从固定的 Corretto 官方 CDN 在线下载，全部经过固定 SHA-256 校验。
- HDC 保留配套 USB 文件并通过 `hdc -v`，返回 `3.2.0b`；完整 JDK 的 java/javac 探测通过，Java 版本 `17.0.21`；HOScrcpy JAR 及来源/许可声明安装通过。
- 只使用新安装的 JDK 和独立 JAR 编译、运行 Java 桥无设备 probe 分支通过，classpath 无 IDE 依赖；验证过程没有使用 DevEco 的任何组件。
- 最初候选 Temurin 的 GitHub 下载在当前网络超时，因此最终默认源改用固定版本的 Amazon Corretto 官方 CDN；更换后真实在线下载与安装通过，不再依赖 GitHub 下载 Java。
- 本次没有访问真机屏幕、发起投屏或控制手机，也未修改用户实际生产配置。新 HDC 与不同版本手机的兼容性仍需用户准备设备后的连接验收；主机准备成功不替代真机验收。
