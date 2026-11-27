import Foundation
import SwiftUI
import Testing
@testable import XopcMobile

/// Architecture guard tests for the unified three-platform mobile design system on iOS.
/// Mirrors HarmonyOS uiInteractionConsistency.test.ts and Android UiArchitectureGuardTest.kt.
struct UIArchitectureGuardTests {
    private static var iosSourceRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // XopcMobileTests
            .deletingLastPathComponent() // apps/mobile-ios
            .appendingPathComponent("XopcMobile", isDirectory: true)
    }

    private static func swiftFiles(under relativePath: String) -> [URL] {
        let dir = iosSourceRoot.appendingPathComponent(relativePath, isDirectory: true)
        guard let enumerator = FileManager.default.enumerator(
            at: dir,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }
        return enumerator.compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" }
    }

    @Test func designTokensMatchThreePlatformSpec() {
        #expect(MobileDesignTokens.pagePaddingX == 16)
        #expect(MobileDesignTokens.sheetPaddingX == 20)
        #expect(MobileDesignTokens.radiusXs == 8)
        #expect(MobileDesignTokens.radiusSm == 12)
        #expect(MobileDesignTokens.radiusMd == 16)
        #expect(MobileDesignTokens.radiusLg == 20)
        #expect(MobileDesignTokens.buttonHeightSm == 36)
        #expect(MobileDesignTokens.buttonHeightMd == 44)
        #expect(MobileDesignTokens.buttonHeightLg == 48)
    }

    @Test func motionTokensMatchThreePlatformSpecAndRespectReduceMotion() {
        #expect(MobileMotion.microDuration == 0.14)
        #expect(MobileMotion.exitDuration == 0.18)
        #expect(MobileMotion.standardDuration == 0.22)
        #expect(MobileMotion.pagerDuration == 0.23)
        #expect(MobileMotion.emphasisDuration == 0.28)
        #expect(MobileMotion.skeletonDuration == 1.2)

        #expect(MobileMotion.duration(MobileMotion.standardDuration, reduceMotion: false) == 0.22)
        #expect(MobileMotion.duration(MobileMotion.standardDuration, reduceMotion: true) == 0)
        #expect(MobileMotion.animation(MobileMotion.standardDuration, reduceMotion: true) == nil)
        #expect(MobileMotion.animation(MobileMotion.standardDuration, reduceMotion: false) != nil)

        #expect(MobileMotion.pagerAnimated(reduceMotion: false, distance: 1))
        #expect(MobileMotion.pagerAnimated(reduceMotion: false, distance: -1))
        #expect(!MobileMotion.pagerAnimated(reduceMotion: false, distance: 2))
        #expect(!MobileMotion.pagerAnimated(reduceMotion: true, distance: 1))
    }

    @Test func sheetPresetsCoverFourCanonicalLevels() {
        #expect(MobileSheetPreset.allCases.count == 4)
        #expect(MobileSheetPreset.compact.dragIndicator == .visible)
        #expect(MobileSheetPreset.medium.dragIndicator == .visible)
        #expect(MobileSheetPreset.large.dragIndicator == .visible)
        #expect(MobileSheetPreset.immersive.dragIndicator == .hidden)
    }

    @Test func themePresetsInitializeAllSemanticRoles() {
        for preset in MobileThemePreset.allCases {
            for dark in [false, true] {
                let theme = MobileTheme(preset: preset, dark: dark)
                #expect(theme.corner(16) > 0)
                _ = (theme.scrim, theme.dangerSoft, theme.success, theme.successSoft, theme.warningFill, theme.warningForeground)
            }
        }
    }

    @Test func clarificationCardUsesSemanticThemeWithoutHexOrBorderStroke() throws {
        let url = Self.iosSourceRoot.appendingPathComponent("Features/Assistant/ClarificationCard.swift")
        let source = try String(contentsOf: url, encoding: .utf8)
        #expect(!source.contains("Self.hex("), "ClarificationCard must not use hardcoded hex colors")
        #expect(!source.contains(".stroke(palette.border"), "ClarificationCard outer surface must stay borderless")
        #expect(!source.contains(".shadow("), "ClarificationCard must stay shadowless")
    }

    @Test func noDecorativeBordersOrShadowsInAppOrFeatures() throws {
        let files = Self.swiftFiles(under: "Features") + Self.swiftFiles(under: "App")
        let shadowOffenders = try files.filter { url in
            try String(contentsOf: url, encoding: .utf8).contains(".shadow(")
        }.map(\.lastPathComponent)
        #expect(shadowOffenders.isEmpty, "Use flat layered surface colors instead of .shadow() in: \(shadowOffenders)")

        let borderOffenders = try files.filter { url in
            let text = try String(contentsOf: url, encoding: .utf8)
            return text.contains(".strokeBorder(") || text.contains(".textFieldStyle(.roundedBorder)")
        }.map(\.lastPathComponent)
        #expect(borderOffenders.isEmpty, "Use borderless layered surface colors instead of decorative borders in: \(borderOffenders)")
    }

    @Test func noResidualNativeSegmentedPickerInFeatures() throws {
        let offenders = try Self.swiftFiles(under: "Features").filter { url in
            let text = try String(contentsOf: url, encoding: .utf8)
            return text.contains(".pickerStyle(.segmented)")
        }.map(\.lastPathComponent)
        #expect(offenders.isEmpty, "Use SegmentedTabs instead of native .pickerStyle(.segmented) in: \(offenders)")
    }

    @Test func noUnguardedDirectEaseWithAnimationInAppOrFeatures() throws {
        let files = Self.swiftFiles(under: "Features") + Self.swiftFiles(under: "App")
        let pattern = try Regex(#"withAnimation\(\.(ease|spring|linear)"#)
        let offenders = try files.filter { url in
            let text = try String(contentsOf: url, encoding: .utf8)
            return text.contains(pattern)
        }.map(\.lastPathComponent)
        #expect(offenders.isEmpty, "Guard animations with MobileMotion.perform or reduceMotion in: \(offenders)")
    }

    @Test func migratedCoreScreensAndSheetsSubscribeToMobileTheme() throws {
        let required = [
            "Features/Profile/FilesView.swift",
            "Features/Assistant/MessageDetailView.swift",
            "Features/Assistant/AgentPicker.swift",
            "Features/Assistant/ReferencePickerView.swift",
            "Features/Assistant/ConversationContextView.swift",
            "Features/Assistant/ExternalIntakeSheet.swift",
            "Features/Assistant/ChatImageGalleryView.swift",
            "Features/Notes/NoteEditorView.swift",
            "Features/Progress/AutomationEditorView.swift",
            "Features/Progress/AutomationRunDetailView.swift",
            "Features/Progress/ProjectManageView.swift",
            "Features/Progress/TaskEditorView.swift",
            "Features/Progress/TaskStatusView.swift"
        ]
        for relative in required {
            let url = Self.iosSourceRoot.appendingPathComponent(relative)
            let text = try String(contentsOf: url, encoding: .utf8)
            #expect(text.contains("mobileTheme"), "\(relative) must subscribe to @Environment(\\.mobileTheme)")
        }
    }

    @Test func unifiedOverflowIconographyAcrossFeaturesAndApp() throws {
        let files = Self.swiftFiles(under: "Features") + Self.swiftFiles(under: "App")
        let offenders = try files.filter { url in
            let text = try String(contentsOf: url, encoding: .utf8)
            return text.contains("\"ellipsis\"")
        }.map(\.lastPathComponent)
        #expect(offenders.isEmpty, "Use \"ellipsis.circle\" instead of bare \"ellipsis\" in: \(offenders)")
    }

    @Test func capabilitiesPlacesSearchAtTopWithDistinctSkillMarketIcon() throws {
        let url = Self.iosSourceRoot.appendingPathComponent("Features/Capabilities/CapabilitiesView.swift")
        let source = try String(contentsOf: url, encoding: .utf8)
        let topSearchPattern = try Regex(#"\.safeAreaInset\(edge:\s*\.top,\s*spacing:\s*0\)\s*\{[\s\S]{0,120}searchField"#)
        let bottomSearchPattern = try Regex(#"\.safeAreaInset\(edge:\s*\.bottom,\s*spacing:\s*0\)\s*\{[\s\S]{0,120}searchField"#)
        #expect(source.contains(topSearchPattern), "CapabilitiesView search must be anchored at top")
        #expect(!source.contains(bottomSearchPattern), "CapabilitiesView must not pin search at bottom")
        #expect(source.contains("systemImage: \"square.grid.2x2\""), "CapabilitiesView skill market must use grid icon")
    }

    @Test func sharedSkeletonHapticsAndSheetPresetAdoption() throws {
        let progressRow = try String(
            contentsOf: Self.iosSourceRoot.appendingPathComponent("Features/Progress/ProgressRow.swift"),
            encoding: .utf8
        )
        #expect(progressRow.contains("MobileListSkeleton("), "ProgressListSkeleton must delegate to MobileListSkeleton")

        let segmentedTabs = try String(
            contentsOf: Self.iosSourceRoot.appendingPathComponent("Core/Views/SegmentedTabs.swift"),
            encoding: .utf8
        )
        #expect(segmentedTabs.contains(".sensoryFeedback("), "SegmentedTabs must provide sensoryFeedback on tab selection")

        let files = Self.swiftFiles(under: "Features") + Self.swiftFiles(under: "App")
        let presetCalls = try files.reduce(0) { count, url in
            let text = try String(contentsOf: url, encoding: .utf8)
            return count + text.components(separatedBy: "mobileSheetPreset(").count - 1
        }
        #expect(presetCalls >= 30, "Expected at least 30 mobileSheetPreset call sites, found \(presetCalls)")
    }

    @Test func auxiliarySemanticColorsAndSheetDetentsMatchThreePlatformSpec() throws {
        let themeSource = try String(
            contentsOf: Self.iosSourceRoot.appendingPathComponent("Core/Views/MobileTheme.swift"),
            encoding: .utf8
        )
        for hex in ["0x382124", "0xFDECEC", "0x352C22", "0xFFF2D2", "0xFFBC63", "0x734600", "0x66D89A", "0x176141", "0x1A2F24", "0xE6F5EC"] {
            #expect(themeSource.contains(hex), "MobileTheme must define canonical three-platform RGB \(hex)")
        }

        let sheetSource = try String(
            contentsOf: Self.iosSourceRoot.appendingPathComponent("Core/Views/MobileSheet.swift"),
            encoding: .utf8
        )
        #expect(sheetSource.contains(".fraction(0.72)"), "MobileSheetPreset.medium must align to 0.72")
        #expect(sheetSource.contains(".fraction(0.88)"), "MobileSheetPreset.large must align to 0.88")
        #expect(sheetSource.contains(".fraction(0.94)"), "MobileSheetPreset.immersive must align to 0.94")

        for rel in [
            "Features/Progress/TaskStatusView.swift",
            "Features/Assistant/AssistantActivityView.swift",
            "Features/Assistant/AssistantOptionsView.swift",
            "Features/Assistant/ChatAttachmentPreview.swift"
        ] {
            let text = try String(contentsOf: Self.iosSourceRoot.appendingPathComponent(rel), encoding: .utf8)
            #expect(!text.contains(".presentationDetents("), "\(rel) must use mobileSheetPreset instead of raw .presentationDetents")
        }
    }

    @Test func spaceLibrarySkeletonsSheetHeadersDynamicTypeAndHapticsAdopted() throws {
        let spaceLibrary = try String(
            contentsOf: Self.iosSourceRoot.appendingPathComponent("Features/Profile/SpaceLibraryView.swift"),
            encoding: .utf8
        )
        #expect(spaceLibrary.contains("TabView(selection:"), "SpaceLibraryView must use interactive TabView(.page)")
        #expect(!spaceLibrary.contains(".pageSelectionSwipe("), "SpaceLibraryView must not fall back to discrete pageSelectionSwipe")
        #expect(spaceLibrary.contains("MobileUndoBar("), "SpaceLibraryView must use MobileUndoBar")
        #expect(spaceLibrary.contains("MobileErrorView("), "SpaceLibraryView must use MobileErrorView")
        #expect(spaceLibrary.contains("MobileEmptyState("), "SpaceLibraryView must use MobileEmptyState")
        #expect(spaceLibrary.contains("MobileListSkeleton("), "SpaceLibraryView must use MobileListSkeleton")
        #expect(spaceLibrary.contains(".sensoryFeedback("), "SpaceLibraryView must trigger haptic feedback on scope change")

        for rel in [
            "Features/Profile/ProfileView.swift",
            "Features/Conversations/ConversationsView.swift",
            "Features/Assistant/PersonalAgentOverview.swift",
            "Features/Progress/ProgressRow.swift"
        ] {
            let text = try String(contentsOf: Self.iosSourceRoot.appendingPathComponent(rel), encoding: .utf8)
            #expect(text.contains("MobileListSkeleton("), "\(rel) must delegate skeletons to MobileListSkeleton")
        }

        for rel in [
            "Features/Assistant/ChatAttachmentPreview.swift",
            "Features/Assistant/MessageDetailView.swift"
        ] {
            let text = try String(contentsOf: Self.iosSourceRoot.appendingPathComponent(rel), encoding: .utf8)
            #expect(text.contains("MobileSheetHeader("), "\(rel) must adopt MobileSheetHeader")
        }

        let dynamicTypeFiles = [
            "Features/Assistant/ClarificationCard.swift",
            "Features/Assistant/ClarificationWizard.swift",
            "Features/Assistant/AssistantOptionsView.swift",
            "Features/Assistant/AssistantComposer.swift",
            "Features/Assistant/ChatResultCapsuleLabel.swift",
            "Features/Assistant/MessageBubble.swift",
            "Features/Progress/ProgressView.swift",
            "Features/Conversations/ConversationsView.swift",
            "Features/Settings/GatewayProfilesView.swift"
        ]
        for rel in dynamicTypeFiles {
            let text = try String(contentsOf: Self.iosSourceRoot.appendingPathComponent(rel), encoding: .utf8)
            #expect(!text.contains(".font(.system(size:"), "\(rel) must use semantic Dynamic Type styles instead of fixed .font(.system(size:))")
        }

        let bubble = try String(
            contentsOf: Self.iosSourceRoot.appendingPathComponent("Features/Assistant/MessageBubble.swift"),
            encoding: .utf8
        )
        #expect(bubble.contains(".sensoryFeedback(.success"), "MessageBubble must trigger success haptic feedback on copy")
    }
}
