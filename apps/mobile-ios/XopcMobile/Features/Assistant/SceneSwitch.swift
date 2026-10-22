import SwiftUI

enum AssistantScene: String, CaseIterable {
    case life
    case work
}

struct AssistantSceneSwitch: View {
    let scene: AssistantScene
    let opening: Bool
    let onSelect: (AssistantScene) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.locale) private var locale

    var body: some View {
        ZStack(alignment: .leading) {
            Capsule()
                .fill(Color(uiColor: .secondarySystemGroupedBackground))
                .frame(width: 64, height: 36)
                .offset(x: scene == .life ? 4 : 68)
                .animation(reduceMotion ? nil : .spring(response: 0.54, dampingFraction: 0.9), value: scene)
            HStack(spacing: 0) {
                ForEach(AssistantScene.allCases, id: \.self) { item in
                    Button {
                        onSelect(item)
                    } label: {
                        Text(verbatim: locale.language.languageCode?.identifier == "zh"
                            ? (item == .life ? "生活" : "工作") : (item == .life ? "Life" : "Work"))
                            .font(.system(size: 14, weight: scene == item ? .medium : .regular))
                            .foregroundStyle(scene == item ? .primary : .secondary)
                            .frame(width: 64, height: 44)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(item == .life && opening)
                    .accessibilityAddTraits(scene == item ? .isSelected : [])
                    .accessibilityIdentifier("home-mode-\(item.rawValue)")
                }
            }
            .padding(.horizontal, 4)
        }
        .frame(width: 136, height: 44)
        .background(Color(uiColor: .tertiarySystemFill), in: Capsule())
    }
}
