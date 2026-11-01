# Computer 独立凭据 HTTP 上传验证

实际运行 Hono Gateway、lazy authenticated 上传路由、设备配对/刷新/请求证明、独立 execution grant 与签名 endpoint hello 的认证，使用合成 PNG/JPEG 图片。端点由测试直接调用经过签名认证的 Runtime connect 注册，传输是夹具；不是完整 Realtime Host、原生 OS 控制或物理 WAN 验收。

第 4 轮通过：独立 desktop.execute grant 可以上传 Computer observation，但没有取得 desktop.observe.screen；旧 owner endpoint 不能代替独立设备执行权。缺少 desktop.computer.v1 的 hello 被拒绝。固定调用路径/单文件/5MiB、设备归属、元数据/类型、截止时间检查通过；PNG/JPEG 仅在内存中交接，不能经普通文件下载读取，未写磁盘；调用方改动原图缓冲区不能改变已提交内容，上传副本清零；撤销后 HTTP 403。

失败保留：第 1 轮夹具显示名与 principal 不一致，被认证拒绝；第 2 轮确认设备 transport 仅许可旧截图文件名，补齐 observation.png/jpg 精确白名单和 MIME 匹配，保留原上限；第 3 轮夹具误把不可公开下载的内存截图当成普通文件，改为验证 getFile/readFile 不可访问及专用 takeComputerFrame 后清零。原始日志 `/tmp/xopc-p3d-computer-upload-e2e-{1,2,3,4}.log` 保留，未放宽预算或认证。

75项新上传/既有截图/既有执行Host/执行权与lazy路由回归、439项包测试、全类型检查通过（集合重叠）。日志 `/tmp/xopc-p3d-computer-upload-regression-2.log`、`/tmp/xopc-p3d-computer-upload-packages-1.log`、`/tmp/xopc-p3d-computer-upload-typecheck-3.log`。

尚未加入 Electron Main 原生入口和远端 Host Computer capability 适配，DESKTOP_HOST_CAPABILITIES 未声明其可用；继续后续开发与完整网络/Native E2E，不能标记 P3d 完成或 main 交付。
