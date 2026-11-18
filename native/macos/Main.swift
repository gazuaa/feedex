import AppKit
import WebKit
import Sparkle

// FeedEx 맥 앱. FeedEx 화면을 창으로 띄우고, 웹 보기의 원문은 로그인이 유지되는 화면으로 겹쳐 보여 준다.
// feedex-reader://open?url= 링크는 예전처럼 따로 읽기 창에서 연다.

/// FeedEx 주소. 개발할 때만 FEEDEX_HOME으로 이 컴퓨터의 시험 서버를 쓴다.
func feedexHome() -> URL {
    if let value = ProcessInfo.processInfo.environment["FEEDEX_HOME"], let url = URL(string: value),
       url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1"].contains(url.host ?? "")) {
        return url
    }
    return URL(string: "https://feedex.jyk.workers.dev/")!
}

@MainActor
final class FeedExApplication: NSObject, NSApplicationDelegate {
    private let notifications = NativeNotifications()
    private var updater: SPUStandardUpdaterController?
    private var main: FeedExWindow?
    private var reader: ReaderWindow?
    private var popups: [UUID: ReaderWindow] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        notifications.onOpen = { [weak self] in
            self?.showMain()
            self?.main?.notificationOpened()
        }
        NSApp.mainMenu = menu()
        showMain()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        // 웹사이트의 맥 앱 열기는 이미 켜져 있거나 닫혀 있던 기본 창을 앞으로 가져온다.
        if urls.contains(where: isMainAppLink) {
            showMain()
            return
        }
        // 로그인 코드는 이 앱이 시작한 시스템 로그인 창으로만 받는다. 여기로 온 것은 쓰지 않는다.
        guard let url = urls.compactMap(articleLink).first else { return }
        readerWindow().display(url)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showMain() }
        return true
    }

    private func menu() -> NSMenu {
        let menu = NSMenu()
        let item = { (title: String, entries: [(String, Selector, String, AnyObject?)]) in
            let top = NSMenuItem()
            let sub = NSMenu(title: title)
            for (label, action, key, target) in entries {
                let entry = sub.addItem(withTitle: label, action: action, keyEquivalent: key)
                entry.target = target
            }
            top.submenu = sub
            menu.addItem(top)
        }
        item("feedex", [
            (NativeLanguage.text("업데이트 확인…", "Check for Updates…"), #selector(SPUStandardUpdaterController.checkForUpdates(_:)), "", updater),
            (NativeLanguage.text("feedex 종료", "Quit feedex"), #selector(NSApplication.terminate(_:)), "q", nil)
        ])
        item(NativeLanguage.text("편집", "Edit"), [
            (NativeLanguage.text("실행 취소", "Undo"), Selector(("undo:")), "z", nil), (NativeLanguage.text("다시 실행", "Redo"), Selector(("redo:")), "Z", nil),
            (NativeLanguage.text("잘라내기", "Cut"), #selector(NSText.cut(_:)), "x", nil), (NativeLanguage.text("복사", "Copy"), #selector(NSText.copy(_:)), "c", nil),
            (NativeLanguage.text("붙여넣기", "Paste"), #selector(NSText.paste(_:)), "v", nil), (NativeLanguage.text("모두 선택", "Select All"), #selector(NSText.selectAll(_:)), "a", nil)
        ])
        item(NativeLanguage.text("보기", "View"), [
            (NativeLanguage.text("feedex 새로고침", "Reload feedex"), #selector(reloadMain), "r", self),
            (NativeLanguage.text("앱 화면 확대", "Zoom In"), #selector(enlargeApp), "+", self),
            (NativeLanguage.text("앱 화면 축소", "Zoom Out"), #selector(shrinkApp), "-", self),
            (NativeLanguage.text("앱 화면 기본 크기", "Actual Size"), #selector(resetAppScale), "0", self),
            (NativeLanguage.text("원문 뒤로", "Back in Article"), #selector(articleBack), "[", self),
            (NativeLanguage.text("원문 앞으로", "Forward in Article"), #selector(articleForward), "]", self)
        ])
        item(NativeLanguage.text("창", "Window"), [
            (NativeLanguage.text("feedex 창 보기", "Show feedex Window"), #selector(showMainFromMenu), "1", self),
            (NativeLanguage.text("창 닫기", "Close Window"), #selector(NSWindow.performClose(_:)), "w", nil)
        ])
        return menu
    }

    @objc private func enlargeApp() { main?.changeAppScale("larger") }
    @objc private func shrinkApp() { main?.changeAppScale("smaller") }
    @objc private func resetAppScale() { main?.changeAppScale("reset") }
    @objc private func reloadMain() { main?.reloadApp() }
    @objc private func articleBack() { main?.articleBack() }
    @objc private func articleForward() { main?.articleForward() }
    @objc private func showMainFromMenu() { showMain() }

    private func showMain() {
        let window = main ?? {
            let created = FeedExWindow(home: feedexHome(), notifications: notifications)
            created.onCheckForUpdates = { [weak self] in self?.updater?.checkForUpdates(nil) }
            created.onLanguageChanged = { [weak self] in if let self { NSApp.mainMenu = self.menu() } }
            created.onPopup = { [weak self] configuration in self?.popup(configuration) }
            main = created
            return created
        }()
        window.showWindow(nil)
        window.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func readerWindow() -> ReaderWindow {
        if let reader { return reader }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let window = ReaderWindow(configuration: configuration)
        window.onPopup = { [weak self] configuration in self?.popup(configuration) }
        reader = window
        return window
    }

    /// 사이트가 연 로그인 창. 같은 저장소를 써서 로그인 결과가 원문 화면에도 남는다.
    private func popup(_ configuration: WKWebViewConfiguration) -> ReaderWindow? {
        let id = UUID()
        let popup = ReaderWindow(configuration: configuration)
        popup.onPopup = { [weak self] configuration in self?.popup(configuration) }
        popup.onClose = { [weak self] in self?.popups.removeValue(forKey: id) }
        popups[id] = popup
        return popup
    }
}

@main
struct FeedExMain {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = FeedExApplication()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
