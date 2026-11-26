import SwiftUI

enum ProjectCreationSheet: String, Identifiable {
    case task
    case note

    var id: String {
        rawValue
    }

    var actionTitle: LocalizedStringKey {
        switch self {
        case .task: "新建项目任务"
        case .note: "新建项目笔记"
        }
    }
}

enum ProjectSection: String, CaseIterable, Identifiable {
    case overview
    case conversations
    case tasks
    case notes
    case automations

    var id: String {
        rawValue
    }

    var title: LocalizedStringResource {
        switch self {
        case .overview: "概览"
        case .conversations: "对话"
        case .tasks: "任务"
        case .notes: "笔记"
        case .automations: "自动化"
        }
    }
}
