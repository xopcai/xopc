# 鸿蒙邀请测试提交检查

日期：2026-09-17。使用 app-metadata-audit-skill 核对实际 AGC 表单与本地实现；本检查不代表平台审核通过。

已在 AGC 创建测试草稿 `2041502911694922112`，描述“Mate 60 首轮测试 · HarmonyOS 6.1”。未发布、未提交审核、未生成安装链接。负责人信息已由用户在后台填写，验证码输入框已锁定；不把手机号或验证码复制到仓库。

| 字段或门禁 | 状态 | 处理 |
| --- | --- | --- |
| 名称与包名 | 本地与 AGC APP ID 已统一，分发待配置 | xopc / ai.xopc.xopc；旧 AGC 记录为 ai.xopc.mobile |
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

## 2026-10-11 更新

旧分发记录已由用户删除，新包名 ai.xopc.xopc（APP ID 6917618744771171142）的分发记录已创建。名称、包内 PNG 图标、效率分类和标签、官网及公开客服邮箱已保存并回读确认。正式版本草稿 ID 为 2058644808964037312；旧邀测版本仅作历史证据，新邀测版本尚未创建。Release HAP / APP 已构建并使用新 Release Profile 签名，APP 内 HAP 签名回验通过；包名与 APP ID 匹配。上传、隐私声明、测试网关访问与真机验收仍待完成。

2026-10-11 上传后平台返回 991。发现并修正遗漏的 APP 外层签名；外层 APP 与内部 HAP 本地验签均通过。修正包等待重新上传及 AGC 合法性检测，不能标为平台检测通过。

2026-10-11 09:47:07 修正 APP 已上传。AGC 页面回读确认文件 xopc-0.1.0-ai.xopc.xopc-release-signed.app、包名 ai.xopc.xopc、版本 0.1.0（1）、手机/平板、用途测试和正式上架，合法性“已达标”；上架自检仍为“检测中”。此结果不表示自检或审核通过。

2026-10-11 10:05 隐私协议 `2058664212267329472` 已生成，AGC 状态“完成”，并关联邀请测试草稿 `2058659503649384768`，平台显示“保存成功”。专用测试网关地区和下游服务已由用户确认为中国、阿里云模型/搜索/语音。测试日期、测试用户、负责人手机验证、网关审核访问与真机验收仍待完成；尚未提交审核。
