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
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            .background(theme.panel, in: Capsule())
            .contentShape(Capsule())
        }.accessibilityIdentifier(identifier)
    }
}

struct HorizontalSwipeCapture: UIViewRepresentable {
    var leftOnly = false
    var rightOnly = false
    var reserveBackEdge = false
    var reserveTrailingEdge = false
    var respectsHorizontalScroll = false
    var prioritizeSelection = false
    var onDrag: (CGFloat) -> Void = { _ in }
    var onEnd: (CGFloat, CGFloat) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

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
        private var canScrollLeft = false
        private var canScrollRight = false

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

        func gestureRecognizer(_: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let region, let window = region.window, region.bounds.contains(touch.location(in: region)) else {
                return false
            }
            let touchX = touch.location(in: window).x
            guard !capture.reserveBackEdge || touchX >= 24,
                  !capture.reserveTrailingEdge || touchX <= window.bounds.width - 24
            else { return false }

            canScrollLeft = false
            canScrollRight = false
            if capture.respectsHorizontalScroll {
                var presented = window.rootViewController?.presentedViewController
                while let controller = presented {
                    if !controller.isBeingDismissed, let presentedView = controller.viewIfLoaded,
                       !region.isDescendant(of: presentedView)
                    {
                        return false
                    }
                    presented = controller.presentedViewController
                }
                var target = touch.view
                while let view = target, view !== window {
                    if let scroll = view as? UIScrollView, scroll.isScrollEnabled,
                       let range = horizontalScrollRange(scroll)
                    {
                        // Decide ownership using the scroll position at touch-down.
                        canScrollLeft = canScrollLeft || scroll.contentOffset.x > range.lowerBound + 1
                        canScrollRight = canScrollRight || scroll.contentOffset.x < range.upperBound - 1
                    }
                    target = view.superview
                }
            }
            return true
        }

        func gestureRecognizerShouldBegin(_: UIGestureRecognizer) -> Bool {
            let offset = pan.translation(in: nil)
            return abs(offset.x) > abs(offset.y) * 1.25
                && (!capture.leftOnly || offset.x < 0)
                && (!capture.rightOnly || offset.x > 0)
                && !(offset.x > 0 ? canScrollLeft : canScrollRight)
        }

        func gestureRecognizer(_: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool
        {
            guard !capture.prioritizeSelection, let scroll = other.view as? UIScrollView else { return false }
            return !capturesHorizontalScrollPan(other, in: scroll)
        }

        func gestureRecognizer(_: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            guard let scroll = other.view as? UIScrollView else { return false }
            return capturesHorizontalScrollPan(other, in: scroll)
                || (capture.prioritizeSelection && other === scroll.panGestureRecognizer)
        }

        private func capturesHorizontalScrollPan(_ recognizer: UIGestureRecognizer, in scroll: UIScrollView) -> Bool {
            capture.respectsHorizontalScroll && recognizer === scroll.panGestureRecognizer
                && (scroll.alwaysBounceHorizontal || horizontalScrollRange(scroll) != nil)
        }

        private func horizontalScrollRange(_ scroll: UIScrollView) -> ClosedRange<CGFloat>? {
            let inset = scroll.adjustedContentInset
            let start = -inset.left
            let end = scroll.contentSize.width - scroll.bounds.width + inset.right
            return end > start + 1 ? start ... end : nil
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

private struct PageSelectionSwipe<Value: Equatable>: ViewModifier {
    @Environment(\.layoutDirection) private var direction
    let pages: [Value]
    let selected: Value
    let enabled: Bool
    let prioritizeSelection: Bool
    let onSelect: (Value) -> Void

    func body(content: Content) -> some View {
        content.background {
            if enabled, let index = pages.firstIndex(of: selected), pages.count > 1 {
                let rtl = direction == .rightToLeft
                HorizontalSwipeCapture(leftOnly: rtl ? index == pages.count - 1 : index == 0,
                                       rightOnly: rtl ? index == 0 : index == pages.count - 1,
                                       reserveBackEdge: true, prioritizeSelection: prioritizeSelection)
                { distance, speed in
                    guard abs(distance) >= 64 || (abs(distance) >= 24 && abs(speed) >= 550 && distance * speed > 0)
                    else { return }
                    let target = index + ((distance < 0) != rtl ? 1 : -1)
                    if pages.indices.contains(target) {
                        onSelect(pages[target])
                    }
                }
            }
        }
    }
}

extension View {
    func pageSelectionSwipe<Value: Equatable>(
        _ pages: [Value],
        selected: Value,
        enabled: Bool = true,
        prioritizeSelection: Bool = false,
        onSelect: @escaping (Value) -> Void
    ) -> some View {
        modifier(PageSelectionSwipe(pages: pages, selected: selected, enabled: enabled,
                                    prioritizeSelection: prioritizeSelection, onSelect: onSelect))
    }
}

@Observable
final class PageScrollProgress {
    var page: CGFloat?
}

struct MobilePagePager<Value: Hashable, Page: View>: View {
    let pages: [Value]
    @Binding var selection: Value
    let progress: PageScrollProgress
    @ViewBuilder let page: (Value) -> Page

    @Environment(\.layoutDirection) private var direction
    @Namespace private var scrollSpace

    var body: some View {
        GeometryReader { geometry in
            ScrollView(.horizontal) {
                HStack(spacing: 0) {
                    ForEach(pages, id: \.self) { value in
                        page(value)
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .accessibilityHidden(value != selection)
                            .id(value)
                    }
                }
                .scrollTargetLayout()
                .onGeometryChange(for: CGFloat.self) { proxy in
                    let frame = proxy.frame(in: .named(scrollSpace))
                    let offset = direction == .rightToLeft ? frame.maxX - geometry.size.width : -frame.minX
                    return offset / max(1, geometry.size.width)
                } action: { progress.page = $0 }
            }
            .scrollIndicators(.hidden, axes: .horizontal)
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: Binding<Value?>(get: { selection }, set: { value in
                if let value, value != selection {
                    selection = value
                }
            }), anchor: .center)
            .coordinateSpace(name: scrollSpace)
        }
    }
}

struct SegmentedTabs<Value: Hashable>: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let options: [SegmentOption<Value>]
    let selected: Value
    let label: LocalizedStringKey
    var minimumSegmentWidth: CGFloat = 64
    var swipeToSelect = false
    var pagerProgress: PageScrollProgress?
    let onSelect: (Value) -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var direction
    @ScaledMetric(relativeTo: .subheadline) private var height = 46
    @ScaledMetric(relativeTo: .subheadline) private var scale = 1.0
    @State private var trackWidth: CGFloat = 0

    var body: some View {
        GeometryReader { geometry in
            let canSwipe = swipeToSelect && trackWidth > 0 && trackWidth <= geometry.size.width + 0.5
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    let selectedIndex = options.firstIndex { $0.id == selected }
                    let page = pagerProgress?.page ?? selectedIndex.map { CGFloat($0) } ?? -1
                    SegmentTrack(viewportWidth: geometry.size.width, height: height, direction: direction, page: page) {
                        RoundedRectangle(cornerRadius: mobileTheme.corner(18) * scale)
                            .fill(colorScheme == .dark ? mobileTheme.active : mobileTheme.panel)
                            .opacity(selectedIndex == nil ? 0 : 1)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                        ForEach(options) { option in
                            button(for: option)
                                .id(option.id)
                                .layoutValue(key: SegmentMinimumWidth.self, value: (option.minimumWidth ?? minimumSegmentWidth) * scale)
                        }
                    }
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { trackWidth = $0 }
                    .background(mobileTheme.input, in: .rect(cornerRadius: mobileTheme.corner(18) * scale))
                    .clipShape(.rect(cornerRadius: mobileTheme.corner(18) * scale))
                    .animation(reduceMotion || pagerProgress != nil ? nil : MobileMotion.standardCurve(duration: MobileMotion.pagerDuration), value: selected)
                }
                .scrollDisabled(canSwipe)
                .pageSelectionSwipe(options.map(\.id), selected: selected, enabled: canSwipe,
                                    prioritizeSelection: true, onSelect: onSelect)
                .scrollIndicators(.hidden)
                .onChange(of: selected, initial: true) {
                    MobileMotion.perform(MobileMotion.standardDuration, reduceMotion: reduceMotion) { proxy.scrollTo(selected) }
                }
                .onChange(of: geometry.size.width) { proxy.scrollTo(selected) }
            }
        }
        .frame(height: height)
        .sensoryFeedback(.selection, trigger: selected)
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
            .animation(MobileMotion.animation(MobileMotion.microDuration, reduceMotion: reduceMotion), value: active)
            .fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, minHeight: height)
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
    var page: CGFloat

    var animatableData: CGFloat {
        get { page }
        set { page = newValue }
    }

    private func widths(_ subviews: Subviews) -> [CGFloat] {
        let naturalWidths = subviews.dropFirst().map { max($0[SegmentMinimumWidth.self], $0.sizeThatFits(.unspecified).width) }
        let extra = max(0, viewportWidth - naturalWidths.reduce(0, +)) / CGFloat(max(naturalWidths.count, 1))
        return naturalWidths.map { $0 + extra }
    }

    func sizeThatFits(proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        CGSize(width: widths(subviews).reduce(0, +), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        let widths = widths(subviews)
        guard let indicator = subviews.first, !widths.isEmpty else { return }

        func place(_ subview: LayoutSubview, start: CGFloat, width: CGFloat) {
            let center = start + width / 2
            subview.place(at: CGPoint(x: direction == .rightToLeft ? bounds.maxX - center : bounds.minX + center,
                                      y: bounds.midY),
                          anchor: .center, proposal: ProposedViewSize(width: width, height: height))
        }

        let clampedPage = min(max(0, page), CGFloat(widths.count - 1))
        let left = Int(clampedPage)
        let right = min(left + 1, widths.count - 1)
        let fraction = clampedPage - CGFloat(left)
        let indicatorStart = widths.prefix(left).reduce(0, +) + widths[left] * fraction
        let indicatorWidth = widths[left] + (widths[right] - widths[left]) * fraction
        place(indicator, start: indicatorStart, width: indicatorWidth)

        var offset: CGFloat = 0
        for (subview, width) in zip(subviews.dropFirst(), widths) {
            place(subview, start: offset, width: width)
            offset += width
        }
    }
}
