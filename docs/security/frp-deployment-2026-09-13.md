# FRP 安全升级部署记录 — 2026-09-13

## 已上线

生产 Broker / frps / Nginx 及当前本机 Gateway 已完成升级。生产仅有一条活动隧道；迁移后仍为一条活动签名租约及一条已绑定永久 reservation，原公网地址未改变，配对身份未轮换。

- 发布目录：`/var/www/xopc-frp-releases/20260913-103653`。PM2 的 `xopc-broker` 从此目录运行；常规 `/var/www/xopc-platform` 中的 Broker 源码、构建产物和部署模板也已同步，防止后续运维启动旧实现。
- 备份：发布目录下 `backup/` 保存一致的 Broker/Auth SQLite 备份、原 Nginx/frps 配置、旧二进制和旧 Broker checkout，目录仅 root 可读。Gateway 的一致 SQLite/config/租约备份位于 `~/.xopc/backups/frp-security-20260913-103653/`。
- 发布前在生产数据库副本上验证了旧域名冻结与迁移，在独立候选 Nginx 配置上执行了 `nginx -t`，核验了 frps 摘要和证书有效期。
- frps 使用 `frps` 系统用户，`NoNewPrivileges=yes`，控制通道强制 TLS。443 为 Nginx 原生 TLS；7100/7110/8080 只监听 127.0.0.1，4443/7500 已无监听。firewalld 的运行时和持久规则均未开放这些内部端口。
- 已安装 frps 证书续期同步 hook，并删除已废弃模块残留的编译文件。证书截至 2026-11-20 有效；未人为触发一次真实续签。

## 已验证

公网 Broker health 200，`/frp/handler` 404；Console、Store、Link、Share health、模型网关 health 及官网 `/zh` 均 200。

通过原隧道公网地址验证：匿名私有请求 401；owner credential 可兑换 Secure/HttpOnly/host-only Cookie；Cookie 请求成功，缺 Origin 的 mutation 403；退出登录后旧 Cookie 401。WSS 实际建连成功，退出登录主动关闭该连接；公网 identity challenge 验签与本机 SQLite 内的固定 Gateway 公钥一致。

生产 Broker SQLite `integrity_check` 为 `ok`。本次未撤销用户真实 Registration Key 做故障注入；平台撤销在此前真实 frpc/frps 的隔离链路中验证，生产负载下的时延 SLA 尚未测量。

## 客户端发布

Gateway 与 Web 已构建并通过现有重启 API 切换到新代码。浏览器扩展新 ZIP 已发布，已安装扩展仍需更新：[下载扩展 ZIP](https://frp.xopc.ai/bin/xopc-browser-bridge-0.0.271-security-20260913.zip)。

移动端：全量 lint/typecheck、854 项移动端测试和 17 项 stream-client 测试通过；Android APK 已完成原生编译、签名与上传，原生策略标记检查通过，签名与线上 Android App Links association 一致，线上文件 SHA-256 与本地验证产物一致：[下载 Android APK](https://frp.xopc.ai/bin/xopc-android-0.0.54-security-20260913.apk)。iOS 原生 IPA / TestFlight 构建发布进行中。旧手机安装包不支持新的签名 refresh 响应，须安装新原生包；仅刷新页面或 OTA JS 不足以升级原生上传保护。最终产物与状态将在构建完成后补充。

安装包检查发现 Expo 56 默认使用预编译原生模块，最初 APK 未包含文件系统源码补丁，已被发布检查拒绝。现显式配置 `expo.autolinking.buildFromSource=["expo-file-system"]`，同时在 Android 和 iOS 发布脚本中强制检查原生二进制内的上传策略标记；不以 JS bundle 内存在同名字符串代替原生检查。

## 回退约束

当前已完成永久 reservation 绑定，不能直接覆盖回旧 Broker 数据库，或重新启用旧无签名注册。回退前须保留当前 reservation 与新租约记录并停止写入；不得绕过 relay 或关闭 TLS 验证恢复连接。备份是灾难恢复资料，不是允许旧协议重新开放的开关。

B0 加密协议实验、B1/B2 均未部署；当前平台仍终结 HTTPS，不具备平台不可读的端到端加密保证。详见 [实现记录](frp-implementation-progress-2026-09-13.md)。
