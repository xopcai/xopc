import SwiftUI

/// Harmony's text hierarchy with iOS Dynamic Type scaling.
enum MobileTextStyle {
    case body, rowTitle, secondary, caption, smallCaption, footnote
    case detailTitle, sectionTitle, heading, heading2

    var size: CGFloat {
        switch self {
        case .body, .rowTitle: 16
        case .secondary: 14
        case .caption: 12
        case .smallCaption: 11
        case .footnote: 13
        case .detailTitle: 21
        case .sectionTitle: 18
        case .heading: 24
        case .heading2: 20
        }
    }

    var weight: Font.Weight {
        switch self {
        case .rowTitle, .sectionTitle: .medium
        case .detailTitle, .heading, .heading2: .bold
        default: .regular
        }
    }

    var relativeTo: Font.TextStyle {
        switch self {
        case .caption, .smallCaption: .caption
        case .footnote: .footnote
        case .secondary: .subheadline
        case .rowTitle: .headline
        case .detailTitle, .heading, .heading2: .title2
        case .sectionTitle: .title3
        case .body: .body
        }
    }
}

private struct MobileFontModifier: ViewModifier {
    let style: MobileTextStyle
    @ScaledMetric private var size: CGFloat

    init(style: MobileTextStyle) {
        self.style = style
        _size = ScaledMetric(wrappedValue: style.size, relativeTo: style.relativeTo)
    }

    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: style.weight))
    }
}

extension View {
    func mobileTextStyle(_ style: MobileTextStyle) -> some View {
        modifier(MobileFontModifier(style: style))
    }
}
