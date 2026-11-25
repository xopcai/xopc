import SwiftUI

/// Unified Calm-Intelligence motion timing tokens aligned across iOS, Android, and HarmonyOS.
enum MobileMotion {
    static let microDuration: Double = 0.14
    static let exitDuration: Double = 0.18
    static let standardDuration: Double = 0.22
    static let pagerDuration: Double = 0.23
    static let emphasisDuration: Double = 0.28
    static let skeletonDuration: Double = 1.2

    static func duration(_ seconds: Double, reduceMotion: Bool) -> Double {
        if reduceMotion || seconds <= 0 {
            return 0
        }
        return seconds
    }

    static func standardCurve(duration: Double = standardDuration) -> Animation {
        .timingCurve(0.32, 0.72, 0, 1, duration: duration)
    }

    static func animation(_ seconds: Double = standardDuration, reduceMotion: Bool) -> Animation? {
        let resolved = duration(seconds, reduceMotion: reduceMotion)
        return resolved > 0 ? standardCurve(duration: resolved) : nil
    }

    static func pagerAnimated(reduceMotion: Bool, distance: Int = 1) -> Bool {
        !reduceMotion && abs(distance) == 1
    }

    static func pagerAnimation(reduceMotion: Bool, distance: Int = 1) -> Animation? {
        pagerAnimated(reduceMotion: reduceMotion, distance: distance)
            ? standardCurve(duration: pagerDuration)
            : nil
    }

    static func perform(_ seconds: Double = standardDuration, reduceMotion: Bool, _ body: () -> Void) {
        withAnimation(animation(seconds, reduceMotion: reduceMotion), body)
    }
}
