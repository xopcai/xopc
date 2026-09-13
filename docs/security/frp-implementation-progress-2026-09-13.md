# FRP 安全实现与验证记录

依据 [技术方案](https://github.com/xopcai/xopc/blob/main/docs/design/frp-secure-access-plan-2026-09-13.md)。本次在 `xopc` 与相邻 `xopc-platform` 仓库实现；代码未提交。用户随后授权部署，服务器与当前 Gateway 已上线，实际状态见 [部署记录](frp-deployment-2026-09-13.md)。A0–A2 的代码与本地自审已完成；下文保留初次本地验收记录，后续 Linux 与原生端发布结果以部署记录为准。B0 仅完成协议实验，B1/B2 未实现，不能宣称全方案完成或平台已经无法读取数据。

## 阶段一：入口、鉴权与供应链（A0/A1）

- frpc 显式校验证书链和服务端名称；固定官方 v0.62.1 六个平台压缩包及可执行文件 SHA-256。缓存、环境变量指定的二进制也先校验；下载限时/限大小，原子落盘，私密配置 0600、目录 0700，停止后删除。
- 公网隧道要求实际解析后的 token 鉴权，拒绝 none/password/trusted-proxy 模式；Gateway 启动、CLI、HTTP 设置及自动恢复使用同一策略。公网模式不会被 loopback 豁免或通用环境变量关闭限流。
- Nginx 原生 HTTPS 443 → 本机授权 relay 7110 → frps vhost 8080 → TLS frpc → Gateway。frps 非 root，控制通道强制 TLS，管理面取消，业务端口 loopback；公网不能访问插件接口。续期同步 frps 证书。
- 来源 IP 只接受 socket/显式可信代理；Nginx 覆盖外部转发头。FRP NewProxy 严格校验类型、代理名、内部域名、公网 Host 改写以及其他可绕过路由的字段，未知插件操作拒绝。
- 删除无校验下载、query-token 头像、代理名别名、无效 frps admin 踢线和未使用的客户端 DNS challenge 分支。证书签发使用的运维 DNS 脚本保留。

自审发现并修复：配置权限在已存在目录上也要收紧；证书续期需同步非 root frps 的文件；部署先校验归档再解压；限流不能信任反向代理后的 loopback；日志过滤补齐 Cookie/Set-Cookie/签名载荷；well-known 不允许跨 origin 转交凭据，所有相关下载/注册请求禁止重定向。

## 阶段二：地址归属与强制撤销（A2）

- 注册 v2 使用现有 Gateway Ed25519 身份，签名覆盖 Broker audience、身份、公钥、平台、版本、地址恢复证明、nonce 与期限。nonce 在事务内消费，不保留旧无签名 hash 注册 API。
- 永久 hostname reservation 与活动租约分离；注销、到期与清理只删除活动租约。每次租约使用新的内部 FRP hostname，公网地址保持不变。相同身份替换存活租约还须证明当前租约 token，阻止旧克隆反复抢占。
- 一次性迁移冻结旧地址，使旧无签名租约失效；同一归属主体凭旧租约 token 和新身份签名认领。无恢复证明的历史地址不重新分配。新分配地址长度超出旧随机地址范围，防止碰撞历史上已被删除的地址。
- Broker 在注册、心跳、插件回调和 relay 检查权威 Auth SQLite：key 撤销/过期、用户/组织禁用、workspace/principal 绑定变化均会失效。relay 每秒按租约合并检查，主动关闭 HTTP 流与 WS，不依赖客户端 Ping；数据库检查失败拒绝连接。
- Gateway 区分 401/403 撤销、410 过期和临时网络失败；撤销不自动重新注册，普通断网保留身份与恢复凭据。心跳互斥与 generation 检查防止旧异步结果覆盖新连接。

自审发现并修复：frps 0.62.1 的 offline stats 删除不能踢在线连接，因此取消 admin housekeeping，改由实际持有数据 socket 的 relay 执行撤销；同一公网 hostname 不能直接复用为 FRP 内部 hostname；HTTP pipelining 下每条活动请求单独登记，避免 socket Map 覆盖；数据迁移增加事务、重启幂等与旧地址测试。

## 阶段三：浏览器会话与移动端保护（A2）

- 浏览器 owner credential 一次交换为 HttpOnly、Secure、SameSite=Strict、host-only Cookie；SQLite 只保存随机会话 token 的摘要与凭据指纹。30 天会话、最后 7 天滑动续期、上限 32；凭据轮换立即使旧会话失效。localhost 使用单独 Cookie 名称。
- Web 状态仅保存公开 sessionKey。旧 localStorage 凭据只做一次兑换，成功后清除，不继续读写作为鉴权路径。REST、图片、文件、实时票据均走 Cookie 会话；unsafe 请求检查 Origin。
- 退出登录撤销会话、未使用的 realtime/voice ticket 和已建立连接；设备撤销同时覆盖 realtime 与 voice。修复了分享/笔记/exposure handler 二次要求 Bearer 导致 Cookie 用户无法使用的问题。
- 手机沿用原配对身份，固定公钥从已配对缓存一次迁入 SecureStore；后续不允许普通缓存或发现结果覆盖。发送凭据前验证新鲜签名 challenge，结果短期缓存并发复用；前台恢复清缓存。challenge 是防错端点措施，不是端到端通道，尚无 B 系列能力版本/route epoch 协商。
- refresh 响应 v3 签名绑定 Gateway、nonce、requestId、期限与 tokens；手机和浏览器扩展验签后才持久化。重试保留轮换 journal，拒绝无签名响应；网络失败不清配对。
- 私有图片/文件通过验证过的 API 传输；原生 Image 不持有 Bearer，公网缩略图剥离所有凭据。图片流式写临时文件，单响应上限 100 MiB，React Query 缓存淘汰时删除文件。崩溃遗留缓存由系统缓存清理，尚非应用级磁盘总量预算。
- 固定 `expo-file-system@56.0.11` 原生补丁拒绝上传重定向；iOS 使用 foreground URLSession，Android 关闭两个 redirect 开关。JS 检查原生能力常量，旧原生包拒绝上传；保留文件流式上传，不把整文件读入 JS。

自审发现并修复：真实 Gateway 登录暴露 SQLite schema version 未递增；已修正为 164。会话达到上限时允许原子替换当前会话，新登录超限返回明确 409。SDK 默认上传会跟随重定向，因此仅设置 JS fetch 不够，加入最小原生补丁。错误签名、重放 nonce 和无签名 refresh 不可写入凭据。私有图片 URL 格式错误不会导致 render 抛异常；移除图片调用处残留的 Bearer headers，下载失败继续触发头像降级显示。

## 验证与复现

| 范围 | 本地结果 |
|---|---|
| Gateway/Web/隧道/实时/语音/限流/迁移/日志选定回归集合 | 358 文件、1,729 项通过，1 项原有跳过；新增会话存储/路由专项另 5 项通过 |
| 移动端全套 | 154 文件、854 项通过，包含新增资源 origin / 凭据隔离与 refresh 篡改 / 重放检查 |
| Broker | 7 文件、31 项通过，包含真实 HTTP 流/WS 撤销、权威授权变化、历史库迁移 |
| TypeScript / Web build | 主项目、Web、移动端、浏览器扩展、Broker 类型检查通过；Web build 通过（已有大 chunk 提示） |
| 真 frpc/frps 0.62.1 | 正确 CA/hostname 成功，错误 CA/hostname 失败；注册签名、Login/NewProxy、内部租约路由、公网 Host 恢复、正在传输连接撤销通过 |
| 真 Gateway CLI 启动 | `node scripts/security/gateway-session-smoke.mjs`：Cookie、CSRF、lazy route、identity challenge、WS 建连、logout 关闭连接、未消费 ticket 失效、query-token 拒绝通过 |
| 原生上传重定向 | `node scripts/security/native-upload-redirect-smoke.mjs`：macOS Foundation 编译实际补丁 delegate，1 MiB 上传遇 307 不向目标发送请求；不是 iOS/Android 整包验收 |
| 部署脚本 | shell/Python 静态检查与已知/未知 stream 迁移场景通过；本机无 nginx/systemd，未做生产部署 |

## 交互影响与发布门槛

正常扫码、电脑确认、聊天、地址收藏及前台上传不增加人工安全步骤。以下变化不能隐藏：

1. 新注册/refresh 协议不支持旧格式，需要 Gateway、Broker、手机、扩展协调升级；手机必须新原生安装包，不能只推 OTA JS，也不能用 Expo Go 验收上传。
2. iOS 上传切到后台可能暂停或失败，需回前台重试。若后台持续上传是必须保留的产品要求，先完成受控原生后台上传实现和真机验收，再发布本改动。
3. 证书/身份异常、授权明确撤销、过旧的客户端会中断连接；临时断网不清除配对。历史地址恢复证明丢失会保持冻结。
4. Linux 必须验证 Nginx 配置、端口、服务权限、证书续期，以及生产负载下撤销时延。iOS/Android 必须验证整包构建、弱网、上传取消/恢复、图片缓存、语音、前后台切换和启动 p95；当前没有真机性能数据。

部署顺序、备份与回退约束见相邻 `xopc-platform/docs/broker-vps-deployment.md`。回退不得绕开 relay、关闭证书校验或把新数据库交给旧 Broker；永久 reservation 数据必须保留。

## B0 / B1 / B2

[协议实验](https://github.com/xopcai/xopc/blob/main/experiments/secure-channel/README.md) 固定 Snow 0.10.0，6 项测试通过，包括独立 Cacophony 向量、错误密钥、篡改/重放/乱序/跨会话拒绝与 100 MiB 分块。它没有进入产品依赖。该库尚无正式审计，不能称为已审计方案。

B0 尚缺 Node/iOS/Android 统一绑定、配对身份绑定通道证书、实际 REST/WS/文件/音频与 HTTP fallback、弱网恢复和真机指标。按原方案，这些是 B1 的前置验收条件。B1/B2 未实现、未默认启用，也没有添加自创加密或静默降级路径。当前平台仍终结 HTTPS，能够读取业务数据；HttpOnly 与身份 challenge 不改变这一信任边界。
