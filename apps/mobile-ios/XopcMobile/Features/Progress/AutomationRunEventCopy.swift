import Foundation

enum AutomationRunEventCopy {
    static func display(_ message: String, locale: Locale) -> String {
        if let key = messageKeys[message] {
            return AppLocalization.string(key, locale: locale)
        }
        if message.hasPrefix("Event "), message.hasSuffix(" queued automation") {
            return AppLocalization.string("事件触发，已加入队列", locale: locale)
        }
        for (kind, labelKey) in actionLabels {
            let label = AppLocalization.string(labelKey, locale: locale)
            for (suffix, formatKey) in actionPhases where message == "\(kind) action \(suffix)" {
                return String(format: AppLocalization.string(formatKey, locale: locale), locale: locale, label)
            }
            if message == "Running \(kind) action" {
                return String(format: AppLocalization.string("正在执行%@", locale: locale), locale: locale, label)
            }
        }
        return message
    }

    private static let actionLabels = [
        ("system", "系统操作"),
        ("agent", "助手操作"),
        ("workflow", "工作流"),
        ("browser_automation", "浏览器自动化"),
        ("task_command", "任务操作")
    ]

    private static let messageKeys = [
        "Scheduled run queued": "计划运行已加入队列",
        "Manual run queued": "手动运行已加入队列",
        "Automation run started": "自动化运行已开始",
        "Automation deadline resolved": "已确定运行截止时间",
        "Automation action retry scheduled": "操作即将重试",
        "Automation cancellation requested": "已请求取消运行",
        "Queued automation cancellation requested": "已请求取消运行",
        "Queued automation cancelled before execution": "已确认取消运行",
        "Automation cancellation confirmed": "已确认取消运行",
        "Automation cancellation was not confirmed within the cleanup grace period": "取消操作尚未确认",
        "Automation run succeeded": "自动化运行成功",
        "Automation run failed": "自动化运行失败",
        "Automation run timeout": "自动化运行超时",
        "Automation run cancelled": "自动化运行已取消",
        "Queued automation run recovered after restart": "重启后已恢复排队运行"
    ]

    private static let actionPhases = [
        ("completed", "%@已完成"),
        ("failed", "%@失败"),
        ("cancelled", "%@已取消"),
        ("timeout", "%@超时")
    ]
}

enum AutomationRunErrorCopy {
    static func display(_ error: String, locale: Locale) -> String {
        guard let key = errorKeys[error.lowercased()] else { return error }
        return AppLocalization.string(key, locale: locale)
    }

    private static let errorKeys = [
        "not_found": "自动化目标不存在或已被移除。"
    ]
}
