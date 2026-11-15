import SwiftUI

struct SegmentOption<Value: Hashable>: Identifiable {
    let id: Value
    let title: LocalizedStringResource
    var icon: String?
    var count: Int?
    let accessibilityID: String
}

struct SegmentedTabs<Value: Hashable>: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let options: [SegmentOption<Value>]
    let selected: Value
    let label: LocalizedStringKey
    var minimumSegmentWidth: CGFloat = 64
    let onSelect: (Value) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var direction
    @ScaledMetric(relativeTo: .subheadline) private var height = 46
    @ScaledMetric(relativeTo: .subheadline) private var scale = 1.0

    var body: some View {
        GeometryReader { geometry in
            let count = max(options.count, 1)
            let width = max(geometry.size.width / CGFloat(count), minimumSegmentWidth * scale)
            ScrollView(.horizontal) {
                track(width: width)
            }
            .scrollIndicators(.hidden)
        }
        .frame(height: height)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private func track(width: CGFloat) -> some View {
        let selection = options.firstIndex { $0.id == selected }
        return HStack(spacing: 0) {
            ForEach(options) { option in
                button(for: option, width: width)
            }
        }
        .background(alignment: .leading) {
            if let selection {
                RoundedRectangle(cornerRadius: mobileTheme.corner(20))
                    .fill(mobileTheme.panel)
                    .frame(width: width, height: height)
                    .offset(x: CGFloat(selection) * width * (direction == .rightToLeft ? -1 : 1))
                    .animation(reduceMotion ? nil : .timingCurve(0.32, 0.72, 0, 1, duration: 0.25), value: selection)
                    .accessibilityHidden(true)
            }
        }
        .background(mobileTheme.input, in: .rect(cornerRadius: mobileTheme.corner(20)))
        .clipShape(.rect(cornerRadius: mobileTheme.corner(20)))
    }

    private func button(for option: SegmentOption<Value>, width: CGFloat) -> some View {
        let active = option.id == selected
        return Button {
            onSelect(option.id)
        } label: {
            HStack(spacing: 5) {
                if let icon = option.icon {
                    Image(systemName: icon).imageScale(.small).accessibilityHidden(true)
                }
                Text(option.title).lineLimit(2).multilineTextAlignment(.center)
                if let count = option.count {
                    Text(count, format: .number).font(.caption).monospacedDigit()
                }
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(active ? Color.primary : Color.secondary)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: active)
            .padding(.horizontal, 6)
            .frame(width: width, height: height)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier(option.accessibilityID)
    }
}
