# 鸿蒙 0.1.1 邀请测试提交

2026-10-12 按当前代码构建 `ai.xopc.xopc`，版本 `0.1.1` / code `2`。构建代码基线为 `495a589f448853ed18ba6d4d59445a893584b92d`，版本配置更新另由提交 `572ecc82d` 记录。

- Hvigor Release APP 构建成功；内层 HAP 和外层 APP 均使用现有 Release 证书、新包名 Profile 签名并回验通过。APP 内 HAP 与已回验文件逐字节一致。
- 鸿蒙 host 测试 111 个文件、715 项用例全部通过；品牌资源检查通过。构建有现存 API/ArkTS 警告；本轮未执行真机验收。
- 产物：`.test/release-20261012/xopc-0.1.1-ai.xopc.xopc-release-signed.app`；SHA-256：`ed54467301a27864cddad2516d84868ea1ee4db78705db35b04e2d1f38fafb1c`。
- AGC 于 12:06:17 上传，用途“仅测试”，合法性“已达标”，上架自检“检测中”。
- 新邀请测试版本 ID：`2059455123364571456`；描述“xopc 0.1.1 最新受邀测试”，10 月 12 日至 31 日，沿用 `test` 群组（2 名用户）和已有用户协议。

首次提交被 AGC 拦截：新包包含 `READ_CALENDAR`、`LOCATION`、`APPROXIMATELY_LOCATION`，旧隐私政策仅声明麦克风。复制旧政策并补充三项权限类型、逐次授权、查询数据范围、网关/Agent 传输与聊天记录保存、拒绝和撤回方式。新政策 ID `2059458153472387008`，生成后状态“完成”，关联新测试版本并确认保存成功。

[新版隐私政策](https://agreement-drcn.hispace.dbankcloud.cn/index.html?lang=zh&agreementId=2059458153472387008)。旧版本和旧政策保留。

再次提交成功，页面回读状态“预审中”。AGC 提示预审通过后自动转人工审核；此记录不表示预审、人工审核或新包真机验收通过。
