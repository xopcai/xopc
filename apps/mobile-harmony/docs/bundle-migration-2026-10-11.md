# 鸿蒙包名统一记录（2026-10-11）

目标包名为 `ai.xopc.xopc`，与 Android applicationId、iOS PRODUCT_BUNDLE_IDENTIFIER 保持一致。Android 内部 Kotlin namespace 仍为 `ai.xopc.mobile`，不影响安装身份，无需改动。

## 已完成

- AppScope bundleName、分享启动 Want、后台音频 WantAgent、原生测试与设备验证脚本统一新包名。
- CI 产物检查与测试签名白名单统一新包名，拒绝旧包名 Profile；未改动或复用旧签名材料。
- 邀测资料和隐私政策草稿更新；新 APP ID 已登记为 `6917618744771171142`，新邀测版本 ID 尚未生成；旧 ID 保留在 legacyAgc 中。
- Release assembleHap 与 assembleApp 构建成功，生成未签名 HAP / APP；HAP module.json 确认 bundleName 为 ai.xopc.xopc、debug=false、最低 API 23 / 目标 API 26。
- 构建仍报告现有 ArkTS/API 兼容性警告，未进行真机安装验收。

## AGC 与签名后续

旧应用 ai.xopc.mobile（APP ID 6917616647856901107）已由用户于 2026-10-11 手动删除；随后回读 HarmonyOS 分发列表为空。旧 ID 仅保留为历史记录。新包名 ai.xopc.xopc 已完成 APP ID 注册并关联 xopc 项目；新分发记录已创建，正式版本草稿 ID 为 `2058644808964037312`。

新包名 Release Profile 已创建且签名回验通过；仍需生成 Debug Profile、重新关联开放能力、Push Kit 与签名配置，并更新 CI harmony-testing 的签名 Secrets。生成签名包后验证安装、配对、分享、后台音频及通知点击。

包名变更对应新的安装身份；旧 ai.xopc.mobile 安装不能作为新应用的原地升级验证。先通过新包安装和网关重新配对进行验收，旧数据迁移另行验证。

历史验收与 2026-10-10 的 AGC 报告保留当时旧包名，避免改写历史证据。签名已完成；此记录不表示已经上传或提交审核。

## AGC 登记进度

新 APP ID 登记已回读确认：`6917618744771171142`，名称 `xopc`，包名 `ai.xopc.xopc`。旧应用已由用户手动删除。新分发记录已创建，发布 Profile 已创建并下载。

## 分发元数据同步

2026-10-11 已创建新应用分发记录，支持手机、默认简体中文。名称 xopc、包内 PNG 图标、分类“应用 / 效率”、主标签“日程清单”、附加标签“AI / 笔记”、官网 https://xopc.ai 和客服邮箱 lyxopc.ai@gmail.com 已保存，平台提示“保存成功”，图标预览已回读确认。修改需要版本审核通过后生效。

发布 Profile 表单已准备：xopc-apptest-xopc-20261011，绑定新 APP ID 并选择现有发布证书 xopc-apptest-release-20260917；未申请受限 ACL 权限。用户当场确认后已添加成功，AGC 已自动关联发布证书指纹；Profile 已下载并校验包名、APP ID、类型和有效期。新邀测版本与审核提交尚未完成。

Release 签名包已生成于 `.test/release-20261011/xopc-0.1.0-ai.xopc.xopc-signed.app`，版本 0.1.0 / code 1；APP 内 HAP 签名已回验通过，新包名与 APP ID 均匹配。使用 SDK packing tool 时指定 `--replace-pack-info false` 保留已签名 HAP。SHA-256：`1209737f7e4ae57b65b72783a2135746788ecfc8fefddbe411a40e3b8e6e6b8a`。尚未上传或真机验收；签名材料与构建产物保留在忽略目录内。

上传尝试已打开软件包管理的“上传包”弹窗，但文件选择入口未显示；刷新、新标签页及重新连接后仍有空白页面、控件无 frame 和备用浏览器超时问题。未确认任何上传成功结果，因此状态保留为 draft-upload-pending。

## APP 外层签名修正

用户提供的 2026-10-11 09:44:34 AGC 上传结果显示合法性“不通过（991）”。此前只验证了 APP 内 HAP 签名，遗漏 APP 外层签名，不能据此视为有效分发 APP。检查官方本地 Hvigor SignApp 任务后，已使用相同发布证书和新 Profile 补签 APP 外层，SDK verify-app -inForm zip 验证通过，内含 HAP 保持原样且已验证。

修正产物 `.test/release-20261011/xopc-0.1.0-ai.xopc.xopc-release-signed.app`，大小 1,144,139 字节，SHA-256 `846827a6ca711e9d896389d871248d3f3831a65bb12a1f108e095929ccd6ac77`。原下载路径 xopc-0.1.0-ai.xopc.xopc-signed.app 同步替换为修正产物，旧包另存为 inner-signed-only.app 用于排查。重新上传及 AGC 校验尚待确认，991 的因果关系仍需平台回验。

2026-10-11 09:47:07 修正 APP 已上传。AGC 页面回读确认文件 xopc-0.1.0-ai.xopc.xopc-release-signed.app、包名 ai.xopc.xopc、版本 0.1.0（1）、手机/平板、用途测试和正式上架，合法性“已达标”；上架自检仍为“检测中”。此结果不表示自检或审核通过。

新邀请测试草稿已创建，版本 ID `2058659503649384768`，内部描述“xopc 0.1.0 新包名受邀测试”，当前准备提交。测试配置要求测试时间、包选取、图标与介绍、隐私政策、负责人手机验证码/邮箱/姓名、测试用户与审核访问信息；未提交审核。

邀请测试草稿已关联修正 APP，名称 xopc 和包内图标已继承，应用介绍、测试说明已填入，软件包加密选择“加密（推荐）”。点击保存后平台显示“保存成功”。测试时间、隐私政策、负责人联系方式与手机验证、测试用户和审核网关访问仍未完成。

## 隐私政策关联完成

2026-10-11 10:05 隐私协议 `2058664212267329472` 已生成，状态“完成”，并关联测试版本 `2058659503649384768`，平台确认保存成功。[托管政策链接](https://agreement-drcn.hispace.dbankcloud.cn/index.html?lang=zh&agreementId=2058664212267329472)。用户确认测试网关部署在中国，使用阿里云模型、搜索与语音服务；已披露对应处理范围、麦克风和推送、数据管理及联系邮箱。未经核实的已签署数据保护协议模板段落已移除，第三方处理改在自定义章节说明。

当前尚未提交测试审核。剩余项目为测试日期、测试用户、负责人手机验证、审核网关访问和实体设备验收。以上较早段落保留过程记录，当前状态以本节及 test-metadata.draft.json 为准。
