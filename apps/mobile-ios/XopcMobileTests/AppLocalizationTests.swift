import Foundation
import Testing
@testable import XopcMobile

struct AppLocalizationTests {
    @Test func assistantDynamicTitlesResolveInEnglish() {
        let english = Locale(identifier: "en")

        #expect(AppLocalization.resolve(RealtimeVoiceMode.natural.title, locale: english) == "Live Voice")
        #expect(AppLocalization.resolve(RealtimeVoiceMode.assistant.title, locale: english) == "Voice Assistant")
        #expect(AppLocalization.resolve(ContextReferenceKind.note.title, locale: english) == "Notes")
        #expect(AppLocalization.resolve(ContextReferenceKind.task.title, locale: english) == "Tasks")
        #expect(AppLocalization.resolve(ContextReferenceKind.file.title, locale: english) == "Files")
    }

    @Test func gatewayTaskAndProjectStatesHaveBothLanguageResources() {
        let gatewayValues = ["done", "cancelled", "wont_do", "duplicate", "critical", "waiting", "verifying", "blocked",
                             "project_status_active", "project_status_planned", "project_status_paused",
                             "project_status_completed", "project_status_cancelled", "project_status_archived"]
        for language in ["zh-Hans", "en"] {
            for value in gatewayValues {
                #expect(AppLocalization.string(value, locale: Locale(identifier: language)) != value,
                        "Missing \(language) resource for \(value)")
            }
        }
    }
}
