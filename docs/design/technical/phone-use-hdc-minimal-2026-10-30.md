# HDC 最小下载

Phone Use 的鸿蒙一键安装现在按主机平台只下载 HDC 和 `libusb_shared` 两个原始文件，不再下载 SDK、工具链 ZIP、npm 整包或其他平台的文件。Java 与 HOScrcpy 的安装流程保持独立。

| 主机 | 文件 | 合计字节 | 约 MB（十进制） |
| --- | --- | ---: | ---: |
| macOS arm64 | hdc、libusb_shared.dylib | 6,285,328 | 6.29 |
| macOS x64 | hdc、libusb_shared.dylib | 6,296,288 | 6.30 |
| Linux x64 | hdc、libusb_shared.so | 6,245,888 | 6.25 |
| Windows x64 | hdc.exe、libusb_shared.dll | 5,689,232 | 5.69 |

## 来源

采用固定第三方 [hdw2 2.3.10](https://www.npmjs.com/package/hdw2/v/2.3.10) 分发中的原始文件，通过 jsDelivr 的固定版本路径下载，unpkg 提供同一文件的备用源。它不是华为官方安装包。发布包的 npm SHA-512 integrity 已核对，再从该归档计算每个平台文件的 SHA-256 与准确大小，固化在 `src/runtime-tools/hdc-dependency-catalog.ts`。客户端不下载发布包，不运行其中的 JS 或 postinstall。

HDC 官方说明支持将 HDC 与 USB 依赖放在同一目录独立运行，见 [OpenHarmony HDC 文档](https://github.com/openharmony/docs/blob/master/en/application-dev/dfx/hdc.md)。本次对文件进行了格式及动态依赖检查：macOS 仅需配套 dylib 与系统库，Windows 使用配套 DLL 与 Windows 系统库，Linux 使用配套 so 与系统 C/C++ 运行库。Windows USB 驱动及 Linux USB 访问权限仍由操作系统管理。

## 安装与回退规则

- 每个文件固定 URL、版本、SHA-256 和大小；下载器使用 `Accept-Encoding: identity`，按文件实际大小限制响应，避免误下载大包。
- 仅传输失败可重试同一文件的备用 CDN；校验不匹配直接报错。没有完整 SDK 回退地址。
- 两个文件均校验和暂存后才探测 HDC 并替换托管目录；失败保留原目录。任一配套文件损坏会触发修复，不只依赖 `hdc -v`。
- 缓存与断点续传继续可用；重复安装不重复下载。代理、托管安装开关、会话授权、取消检查及设备占用检查继续沿用。
- 安装目录保存 `source.json`，记录分发来源、版本及每个文件的校验信息。没有全局 PATH、密钥、USB 驱动或系统配置修改。
- 已有 HDC 路径仍可复用；不会删除原 SDK 或旧托管目录。

离线包应包含 catalog `files` 中的两个 `filename`，直接放在所配置的离线目录中。例如 macOS arm64：

```text
hdc-3.2.0c-hdw2-2.3.10-darwin-arm64-hdc
hdc-3.2.0c-hdw2-2.3.10-darwin-arm64-libusb_shared.dylib
```

其他平台使用表中的主机标识替换 `darwin-arm64` 并使用相应目标文件名。旧版完整 SDK 归档不再作为新安装的离线输入；已有安装可通过原 HDC 路径继续使用。

## 验证

macOS arm64 在空的隔离状态目录中执行真实在线安装：仅下载上述两个文件，合计 **6,285,328 字节**，约 **5.86 秒**完成，校验及 `hdc -v` 通过，版本 `3.2.0c`。托管目录只有 HDC、USB 库和来源记录，第二次安装没有重新下载。没有连接、截屏、投屏或控制真机，没有修改生产配置。其他平台已固定文件哈希并做格式/依赖检查，本次未在对应操作系统执行实际安装。

相关回归 84 文件、815 项通过、1 项跳过；后端类型检查、Web 类型检查、Web 构建和修改文件 lint 通过。新增测试覆盖仅下载两个文件、准确总进度、传输错误时只切换原始文件镜像、哈希错误拒绝回退、超大响应立即拒绝、取消、USB 库损坏修复及部分失败保留原安装。
