# 鸿蒙邀请测试提交检查

日期：2026-09-17。使用 app-metadata-audit-skill 核对实际 AGC 表单与本地实现；本检查不代表平台审核通过。

已在 AGC 创建测试草稿 `2041502911694922112`，描述“Mate 60 首轮测试 · HarmonyOS 6.1”。未发布、未提交审核、未生成安装链接。负责人信息已由用户在后台填写，验证码输入框已锁定；不把手机号或验证码复制到仓库。

| 字段或门禁 | 状态 | 处理 |
| --- | --- | --- |
| 名称与包名 | 已核对 | xopc / ai.xopc.mobile |
| 应用介绍、测试说明 | 本地草稿 | 只描述已实现范围，明确真机验收未完成 |
| 测试时间与测试用户 | 待配置 | 限定受邀内部测试，不公开招募 |
| 软件包 | 阻断 | 当前 CI 仅有 Debug 测试签名 HAP；AGC 分发证书/Profile 和分发包仍需配置及验证 |
| 图标 | 待处理 | 现有包内 SVG；平台要求对应的 216 或 1024 正方形 PNG/WEBP，不能上传不同图标 |
| 隐私声明 | 阻断 | 鸿蒙专用草稿尚未确认、生效或托管；不能直接复用包含其他平台服务及未实现授权界面的说明 |
| 隐私入口与授权 | 待核验 | 当前 SettingsView 未提供隐私页/内容共享撤回入口；需确认 AGC 隐私托管覆盖范围或另行实现，不能在政策中声称这些入口已存在 |
| 华为推送个人数据说明 | 待补齐 | 本地已核对 getToken 与注册字段；华为侧完整处理范围和适用条款尚需官方材料确认 |
| 审核可访问环境 | 阻断 | 不擅自将其他平台的审核网关授权用于本次审核；需确认并验证测试环境、访问方式和演示材料 |
| 真机验收 | 未验证 | 云端构建、签名和解密回验不等于 Mate 60 安装或功能验收 |

本轮未改动应用源码、未接受新协议、未上传个人生产数据，未提交正式上架。

## 证据

- 包身份：`AppScope/app.json5`；权限：`entry/src/main/module.json5`。
- 通知：`entry/src/main/ets/service/pushNotifications.ets`。
- 存储：`entry/src/main/ets/service/secureStore.ets`、`gatewaySession.ets`。
- 录音：`entry/src/main/ets/service/voiceCapture.ets`。
- 文件：`entry/src/main/ets/service/fileTransfer.ets`。
- 设置：`entry/src/main/ets/view/SettingsView.ets`。
- [华为 AppTest 测试版本流程](https://developer.huawei.com/consumer/cn/doc/app/agc-help-apptest-release-testapp-0000002292711385)。
- [华为指定设备发布说明](https://developer.huawei.com/consumer/cn/doc/app/agc-help-internal-test-overview-0000002253054942)。
