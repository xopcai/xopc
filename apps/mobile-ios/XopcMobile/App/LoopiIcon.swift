import SwiftUI

private struct LoopiPose {
    var lift: CGFloat = 0
    var ringAngle: Double = 0
    var gaze: CGFloat = 0
    var eyeOpen: CGFloat = 1
}

private struct LoopiMotionKey: Hashable {
    let active: Bool
    let compact: Bool
    let working: Bool
    let greeting: Int
}

struct LoopiIcon: View {
    let size: CGFloat
    let active: Bool
    var compact = false
    var working = false
    var interactive = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var pose = LoopiPose()
    @State private var greeting = 0
    @State private var pendingGreeting = false

    private var motionActive: Bool {
        active && scenePhase == .active && !reduceMotion
    }

    var body: some View {
        Group {
            if interactive {
                Button {
                    guard motionActive else { return }
                    pendingGreeting = true
                    greeting += 1
                } label: {
                    artwork
                }
                .buttonStyle(.plain)
                .accessibilityLabel("助手")
            } else {
                artwork
                    .accessibilityHidden(true)
            }
        }
        .task(id: LoopiMotionKey(active: motionActive, compact: compact, working: working, greeting: greeting)) {
            await runMotion()
        }
    }

    private var artwork: some View {
        ZStack {
            Image("LoopiRing")
                .renderingMode(.original)
                .resizable()
                .frame(width: size, height: size)
                .rotationEffect(.degrees(pose.ringAngle))
                .offset(y: pose.lift * size / 304)
            ZStack {
                Image("LoopiCore")
                    .renderingMode(.original)
                    .resizable()
                    .frame(width: size, height: size)
                Image("LoopiEyes")
                    .renderingMode(.original)
                    .resizable()
                    .frame(width: size * 52 / 304, height: size * 14 / 304)
                    .scaleEffect(x: 1, y: pose.eyeOpen)
                    .offset(x: pose.gaze * size / 304, y: -2 * size / 304)
            }
            .offset(y: pose.lift * size / 200)
        }
        .frame(width: size, height: size)
        .scaleEffect(working ? 1 - pose.lift / 100 : 1)
        .contentShape(.circle)
    }

    private func pause(_ milliseconds: Int) async -> Bool {
        do {
            try await Task.sleep(for: .milliseconds(milliseconds))
            return !Task.isCancelled
        } catch {
            return false
        }
    }

    private func move(to next: LoopiPose, duration: Double) {
        withAnimation(.easeInOut(duration: duration)) {
            pose = next
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    private func runMotion() async {
        pose = LoopiPose()
        guard motionActive else { return }

        if compact, working {
            while !Task.isCancelled {
                move(to: LoopiPose(lift: -6), duration: 0.8)
                guard await pause(850) else { return }
                move(to: LoopiPose(lift: -4, eyeOpen: 0.12), duration: 0.11)
                guard await pause(140) else { return }
                move(to: LoopiPose(), duration: 0.8)
                guard await pause(900) else { return }
            }
            return
        }
        if compact {
            guard await pause(120) else { return }
            move(to: LoopiPose(lift: -2), duration: 0.22)
            guard await pause(260) else { return }
            move(to: LoopiPose(lift: -2, eyeOpen: 0.12), duration: 0.11)
            guard await pause(140) else { return }
            move(to: LoopiPose(lift: -2), duration: 0.18)
            return
        }

        if pendingGreeting {
            pendingGreeting = false
            move(to: LoopiPose(lift: -5, eyeOpen: 0.25), duration: 0.16)
            guard await pause(450) else { return }
            move(to: LoopiPose(), duration: 0.36)
            guard await pause(1650) else { return }
        } else if await !pause(120) {
            return
        }

        while !Task.isCancelled {
            move(to: LoopiPose(lift: -4, ringAngle: -1.2, gaze: .random(in: -2.5 ... 2.5)), duration: 1.2)
            guard await pause(1400) else { return }
            move(to: LoopiPose(eyeOpen: 0.12), duration: 0.11)
            guard await pause(140) else { return }
            move(to: LoopiPose(), duration: 0.18)
            guard await pause(Int.random(in: 1860 ... 4160)) else { return }
        }
    }
}
