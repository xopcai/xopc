import SwiftUI

enum AssistantAction: String, CaseIterable, Identifiable {
    case photo, camera, localFile, voice
    case noteReference, taskReference, fileReference, newConversation

    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .photo: "照片"
        case .camera: "拍照"
        case .localFile: "本地文件"
        case .voice: "语音输入"
        case .noteReference: "引用笔记"
        case .taskReference: "引用任务"
        case .fileReference: "引用文件"
        case .newConversation: "新建会话"
        }
    }

    var systemImage: String {
        switch self {
        case .photo: "photo"
        case .camera: "camera"
        case .localFile, .fileReference: "folder"
        case .voice: "mic"
        case .noteReference: "doc"
        case .taskReference: "checkmark.circle"
        case .newConversation: "square.and.pencil"
        }
    }

    var referenceKind: ContextReferenceKind? {
        switch self {
        case .noteReference: .note
        case .taskReference: .task
        case .fileReference: .file
        default: nil
        }
    }
}

struct AssistantActionPanel: View {
    let canReferenceFiles: Bool
    let canStartRealtimeVoice: Bool
    let onSelect: (AssistantAction) -> Void
    let onRealtimeVoice: (RealtimeVoiceMode) -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 8), count: dynamicTypeSize.isAccessibilitySize ? 2 : 4)
    }

    var body: some View {
        TabView {
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(AssistantAction.allCases) { action in
                    Button {
                        onSelect(action)
                    } label: {
                        tile(title: Text(action.title), image: action.systemImage)
                    }
                    .buttonStyle(.plain)
                    .disabled(action == .fileReference && !canReferenceFiles)
                    .accessibilityLabel(action.title)
                    .accessibilityHint(action == .fileReference && !canReferenceFiles
                        ? AppLocalization.string("发送第一条消息后可引用文件", locale: AppLocalization.selectedLocale)
                        : "")
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)

            HStack(alignment: .top, spacing: 8) {
                ForEach(RealtimeVoiceMode.allCases, id: \.self) { mode in
                    Button { onRealtimeVoice(mode) } label: {
                        tile(title: Text(mode.title), image: mode == .natural ? "waveform" : "speaker.wave.2")
                    }
                    .buttonStyle(.plain)
                    .disabled(!canStartRealtimeVoice)
                    .accessibilityLabel(Text(mode.title))
                    .accessibilityHint(canStartRealtimeVoice
                        ? ""
                        : AppLocalization.string("请先打开对话或等待语音准备完成", locale: AppLocalization.selectedLocale))
                    .frame(maxWidth: .infinity)
                }
                ForEach(0 ..< 2, id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
        }
        .tabViewStyle(.page(indexDisplayMode: .always))
        .frame(height: dynamicTypeSize.isAccessibilitySize ? 258 : 205)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 18))
        .padding(.bottom, 8)
        .accessibilityIdentifier("assistant-action-panel")
    }

    private func tile(title: Text, image: String) -> some View {
        VStack(spacing: 7) {
            Image(systemName: image)
                .font(.system(size: 23, weight: .regular))
                .frame(width: 54, height: 54)
                .background(Color(uiColor: .systemGray5), in: .rect(cornerRadius: 15))
            title
                .font(.caption)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
        }
        .foregroundStyle(.primary)
        .frame(maxWidth: .infinity)
        .contentShape(.rect)
    }
}
