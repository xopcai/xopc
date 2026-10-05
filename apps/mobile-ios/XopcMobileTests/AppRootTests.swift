import Testing
@testable import XopcMobile

@MainActor
struct AppRootTests {
    @Test func applicationModuleLoads() {
        _ = AppRootView()
    }
}
