import SwiftUI
import UIKit

struct SegmentOption<Value: Hashable>: Identifiable {
    let id: Value
    let title: LocalizedStringResource
    var icon: String?
    var count: Int?
    let accessibilityID: String
    var minimumWidth: CGFloat?
}

struct MobilePageTitleMenu<Value: Hashable>: View {
    @Environment(\.mobileTheme) private var theme
    let options: [SegmentOption<Value>]
    let selected: Value
    let identifier: String
    let onSelect: (Value) -> Void

    var body: some View {
        Menu {
            ForEach(options) { option in
                Button { onSelect(option.id) } label: {
                    if option.id == selected {
                        Label(option.title, systemImage: "checkmark")
                    } else {
                        Text(option.title)
                    }
                }
                .accessibilityIdentifier(option.accessibilityID)
                .accessibilityAddTraits(option.id == selected ? .isSelected : [])
            }
        } label: {
            HStack(spacing: 6) {
                if let option = options.first(where: { $0.id == selected }) {
                    Text(option.title).font(.headline).foregroundStyle(theme.foreground).lineLimit(1)
                }
                Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                    .foregroundStyle(theme.secondary).accessibilityHidden(true)
            }
            .frame(minHeight: 44)
        }.accessibilityIdentifier(identifier)
    }
}

struct HorizontalSwipeCapture: UIViewRepresentable {
    var leftOnly = false
    var reserveBackEdge = false
    var onDrag: (CGFloat) -> Void = { _ in }
    var onEnd: (CGFloat, CGFloat) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> SwipeRegion {
        let region = SwipeRegion()
        region.isUserInteractionEnabled = false
        region.windowChanged = { [weak coordinator = context.coordinator, weak region] in
            coordinator?.attach(to: region)
        }
        return region
    }

    func updateUIView(_ uiView: SwipeRegion, context: Context) {
        context.coordinator.capture = self
        context.coordinator.attach(to: uiView)
    }

    static func dismantleUIView(_ uiView: SwipeRegion, coordinator: Coordinator) {
        uiView.windowChanged = nil
        coordinator.attach(to: nil)
    }

    final class SwipeRegion: UIView {
        var windowChanged: (() -> Void)?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            windowChanged?()
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var capture: HorizontalSwipeCapture
        private weak var region: UIView?
        private let pan = UIPanGestureRecognizer()

        init(_ capture: HorizontalSwipeCapture) {
            self.capture = capture
            super.init()
            pan.delegate = self
            pan.maximumNumberOfTouches = 1
            pan.cancelsTouchesInView = true
            pan.addTarget(self, action: #selector(onPan))
        }

        func attach(to region: UIView?) {
            self.region = region
            guard pan.view !== region?.window else { return }
            pan.view?.removeGestureRecognizer(pan)
            region?.window?.addGestureRecognizer(pan)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let region, let window = region.window, region.bounds.contains(touch.location(in: region)) else {
                return false
            }
            return !capture.reserveBackEdge || touch.location(in: window).x >= 24
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            let offset = pan.translation(in: nil)
            return abs(offset.x) > abs(offset.y) * 1.25 && (!capture.leftOnly || offset.x < 0)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            other.view is UIScrollView
        }

        @objc private func onPan() {
            let distance = pan.translation(in: nil).x
            switch pan.state {
            case .began, .changed: capture.onDrag(distance)
            case .ended: capture.onEnd(distance, pan.velocity(in: nil).x)
            case .cancelled, .failed: capture.onEnd(0, 0)
            default: break
            }
        }
    }
}

struct SegmentedTabs<Value: Hashable>: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let options: [SegmentOption<Value>]
    let selected: Value
    let label: LocalizedStringKey
    var minimumSegmentWidth: CGFloat = 64
    let onSelect: (Value) -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var direction
    @ScaledMetric(relativeTo: .subheadline) private var height = 46
    @ScaledMetric(relativeTo: .subheadline) private var scale = 1.0
    @Namespace private var indicator

    var body: some View {
        GeometryReader { geometry in
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    SegmentTrack(viewportWidth: geometry.size.width, height: height, direction: direction) {
                        ForEach(options) { option in
                            button(for: option)
                                .id(option.id)
                                .layoutValue(key: SegmentMinimumWidth.self, value: (option.minimumWidth ?? minimumSegmentWidth) * scale)
                        }
                    }
                    .background(mobileTheme.input, in: .rect(cornerRadius: mobileTheme.corner(18) * scale))
                    .clipShape(.rect(cornerRadius: mobileTheme.corner(18) * scale))
                    .animation(reduceMotion ? nil : .timingCurve(0.32, 0.72, 0, 1, duration: 0.25), value: selected)
                }
                .scrollIndicators(.hidden)
                .onChange(of: selected, initial: true) {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { proxy.scrollTo(selected) }
                }
                .onChange(of: geometry.size.width) { proxy.scrollTo(selected) }
            }
        }
        .frame(height: height)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private func button(for option: SegmentOption<Value>) -> some View {
        let active = option.id == selected
        return Button {
            onSelect(option.id)
        } label: {
            HStack(spacing: 5) {
                if let icon = option.icon {
                    Image(systemName: icon).imageScale(.small).accessibilityHidden(true)
                }
                Text(option.title).lineLimit(1).fontWeight(.bold)
                    .opacity(active ? 1 : 0)
                    .overlay {
                        if !active {
                            Text(option.title).lineLimit(1).fontWeight(.medium)
                        }
                    }
                if let count = option.count {
                    Text(count, format: .number).font(.caption).monospacedDigit()
                }
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(active ? (colorScheme == .dark ? mobileTheme.foreground : mobileTheme.action) : mobileTheme.secondary)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: active)
            .fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, minHeight: height)
            .background {
                if active {
                    RoundedRectangle(cornerRadius: mobileTheme.corner(18) * scale)
                        .fill(colorScheme == .dark ? mobileTheme.active : mobileTheme.panel)
                        .matchedGeometryEffect(id: "selected", in: indicator)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(option.title))
        .accessibilityValue(option.count.map { Text($0.formatted()) } ?? Text(""))
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier(option.accessibilityID)
    }
}

private struct SegmentMinimumWidth: LayoutValueKey {
    static let defaultValue: CGFloat = 0
}

private struct SegmentTrack: Layout {
    let viewportWidth: CGFloat
    let height: CGFloat
    let direction: LayoutDirection

    private func widths(_ subviews: Subviews) -> [CGFloat] {
        let naturalWidths = subviews.map { max($0[SegmentMinimumWidth.self], $0.sizeThatFits(.unspecified).width) }
        let extra = max(0, viewportWidth - naturalWidths.reduce(0, +)) / CGFloat(max(subviews.count, 1))
        return naturalWidths.map { $0 + extra }
    }

    func sizeThatFits(proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        CGSize(width: widths(subviews).reduce(0, +), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        var offset: CGFloat = 0
        for (subview, width) in zip(subviews, widths(subviews)) {
            let center = offset + width / 2
            subview.place(at: CGPoint(x: direction == .rightToLeft ? bounds.maxX - center : bounds.minX + center,
                                      y: bounds.midY),
                          anchor: .center, proposal: ProposedViewSize(width: width, height: height))
            offset += width
        }
    }
}
