import SwiftUI

@main
struct XopcMobileApp: App {
    init() {
        if let language = ProcessInfo.processInfo.environment["XOPC_UI_TEST_LANGUAGE"] {
            UserDefaults.standard.set(language, forKey: "app.language")
        }
    }

    var body: some Scene {
        WindowGroup {
            AppRootView()
        }
    }
}
