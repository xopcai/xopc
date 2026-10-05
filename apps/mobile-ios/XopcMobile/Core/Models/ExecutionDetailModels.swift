import Foundation

struct ExecutionDetailEnvelope: Decodable, Sendable {
    let detail: ExecutionDetail
}

struct ExecutionDetail: Decodable, Equatable, Sendable {
    let turnId: String
    let steps: [ExecutionStep]

    func groups(live: Bool) -> [ExecutionStepGroup] {
        var result: [ExecutionStepGroup] = []
        for step in steps where step.kind != "thinking" {
            let status = step.status == "running" && !live ? "stopped" : step.status ?? "done"
            let category = step.category ?? "other"
            if step.kind == "tool", let last = result.indices.last,
               result[last].kind == "tool", result[last].category == category,
               result[last].status == status, status != "error"
            {
                result[last].steps.append(step)
            } else {
                result.append(ExecutionStepGroup(
                    id: step.id, kind: step.kind, category: category, status: status, steps: [step]
                ))
            }
        }
        return result
    }
}

struct ExecutionStep: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let kind: String
    let category: String?
    let text: String?
    let preview: String?
    let failure: String?
    let status: String?

    var publicPreview: String? {
        preview?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
    }

    var previewURL: URL? {
        guard let publicPreview, let url = URL(string: publicPreview),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil
        else { return nil }
        return url
    }
}

struct ExecutionStepGroup: Equatable, Identifiable, Sendable {
    let id: String
    let kind: String
    let category: String
    let status: String
    var steps: [ExecutionStep]

    var firstPreview: String? {
        steps.compactMap(\.publicPreview).first
    }

    var hasDetails: Bool {
        steps.count > 1 && steps.contains { $0.publicPreview != nil || $0.failure != nil }
    }
}

enum ExecutionCategory {
    static func title(_ category: String) -> String {
        AppLocalization.resolve(titleKeys[category] ?? "使用工具")
    }

    private static let titleKeys: [String: LocalizedStringResource] = [
        "search": "搜索网页",
        "fetch": "打开网页",
        "read": "读取文件",
        "command": "运行命令",
        "write": "写入文件",
        "edit": "编辑文件",
        "share": "分享内容",
        "speech": "生成语音",
        "publish": "发布内容",
        "plan": "更新计划",
        "skill_view": "查看技能",
        "tool_manual": "查看工具说明",
        "inspect_notes": "查看笔记",
        "inspect_tasks": "查看任务",
        "inspect_projects": "查看项目",
        "inspect_automations": "查看自动化",
        "inspect_work": "查看工作",
        "manage_notes": "管理笔记",
        "manage_tasks": "管理任务",
        "manage_projects": "管理项目",
        "manage_automations": "管理自动化",
        "manage_work": "管理工作"
    ]

    static func icon(_ category: String) -> String {
        switch category {
        case "search": "magnifyingglass"
        case "fetch", "share": "link"
        case "read", "skill_view", "tool_manual": "doc.text"
        case "write", "edit": "square.and.pencil"
        case "command": "terminal"
        case "speech": "waveform"
        default: "ellipsis.circle"
        }
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
