import AppKit
import AuthenticationServices
import WebKit

// FeedEx 화면을 띄우는 창. 웹 보기 자리에는 원문을 직접 연 화면을 겹쳐 놓는다. 웹 안에 넣은 사이트와 달리
// 사이트를 직접 연 화면이라 로그인이 유지되고, 프레임을 막는 사이트도 그대로 보인다.
// FeedEx 화면과 원문 화면은 같은 저장소를 써서 앱을 다시 켜도 로그인이 남는다.

/// 왼쪽 위가 원점인 보기. 웹이 알려 주는 자리(CSS 좌표)를 그대로 쓴다.
private final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

/// 메시지 통로가 창을 붙잡아 두지 않게 한다.
private final class WeakMessages: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

func sameOrigin(_ url: URL?, _ other: URL) -> Bool {
    guard let url else { return false }
    return url.scheme == other.scheme && url.host == other.host && (url.port ?? -1) == (other.port ?? -1)
}

/// 다른 앱이나 화면에서 열어도 되는 주소. 웹 주소만 받는다.
func webAddress(_ text: String) -> URL? {
    guard text.utf8.count <= 8192, let url = URL(string: text), let host = url.host, !host.isEmpty,
          url.user == nil, url.password == nil, url.scheme == "https" || url.scheme == "http" else { return nil }
    return url
}

private func number(_ value: Any?) -> CGFloat? {
    if let value = value as? NSNumber { return CGFloat(truncating: value) }
    return nil
}

@MainActor
final class FeedExWindow: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
    let home: URL
    private let app: WKWebView
    private let article: WKWebView
    private let spinner = NSProgressIndicator()
    private var shownArticle: URL?
    private var articleLoad: WKNavigation?
    private var articleReady = false
    private var wantsArticle = false
    private var revealTimer: Timer?
    private var userZoom: CGFloat = 1
    private var signIn: ASWebAuthenticationSession?
    private let debug: DebugTools?
    var onPopup: ((WKWebViewConfiguration) -> ReaderWindow?)?

    init(home: URL) {
        self.home = home
        let store = WKWebsiteDataStore.default()
        let appConfiguration = WKWebViewConfiguration()
        appConfiguration.websiteDataStore = store
        let articleConfiguration = WKWebViewConfiguration()
        articleConfiguration.websiteDataStore = store
        app = WKWebView(frame: .zero, configuration: appConfiguration)
        article = WKWebView(frame: .zero, configuration: articleConfiguration)
        debug = DebugTools.fromEnvironment()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1320, height: 880),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        super.init(window: window)
        window.title = "FeedEx"
        window.minSize = NSSize(width: 420, height: 480)
        window.isReleasedWhenClosed = false
        window.delegate = self
        if !window.setFrameUsingName("FeedExMain") { window.center() }
        window.setFrameAutosaveName("FeedExMain")

        app.configuration.userContentController.add(WeakMessages(self), name: "feedex")
        app.navigationDelegate = self
        app.uiDelegate = self
        article.navigationDelegate = self
        article.uiDelegate = self
        article.isHidden = true
        spinner.style = .spinning
        spinner.controlSize = .regular
        spinner.isDisplayedWhenStopped = false

        let content = FlippedView()
        app.autoresizingMask = [.width, .height]
        content.addSubview(app)
        content.addSubview(article)
        content.addSubview(spinner)
        window.contentView = content
        app.frame = content.bounds
        app.load(URLRequest(url: home))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    func reloadApp() { app.reload() }
    func articleBack() { if !article.isHidden { article.goBack() } }
    func articleForward() { if !article.isHidden { article.goForward() } }

    // MARK: FeedEx 화면이 보내는 메시지

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // FeedEx 화면의 맨 위 문서가 보낸 것만 받는다. 프레임 안의 다른 사이트는 이 통로를 쓰지 못한다.
        guard message.webView === app, message.frameInfo.isMainFrame,
              sameOrigin(message.frameInfo.request.url, home),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        debug?.log(body)
        switch type {
        case "article": place(body)
        case "signIn": startSignIn()
        case "openExternal":
            if let text = body["url"] as? String, let url = webAddress(text) { NSWorkspace.shared.open(url) }
        default: break
        }
    }

    /// 웹 보기 자리에 원문 화면을 놓는다. 새 글은 다 불러오거나 4초가 지난 뒤에 보여 준다.
    private func place(_ body: [String: Any]) {
        guard let text = body["url"] as? String, let url = webAddress(text) else {
            wantsArticle = false
            updateArticle()
            return
        }
        if url != shownArticle {
            shownArticle = url
            articleReady = false
            articleLoad = article.load(URLRequest(url: url))
            revealTimer?.invalidate()
            revealTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated { self?.reveal() }
            }
        }
        var refit = false
        if let rect = body["rect"] as? [String: Any], let x = number(rect["x"]), let y = number(rect["y"]),
           let width = number(rect["width"]), let height = number(rect["height"]) {
            refit = abs(article.frame.width - width) > 1
            article.frame = NSRect(x: x, y: y, width: max(0, width), height: max(0, height))
        }
        if let zoom = number(body["zoom"]), zoom >= 0.25, zoom <= 3, zoom != userZoom { userZoom = zoom; refit = true }
        wantsArticle = !((body["hidden"] as? Bool) ?? false)
        updateArticle()
        if refit && articleReady { fit() }
    }

    /// 폭이 고정된 사이트가 자리보다 넓으면 한눈에 들어오게 줄인다. 웹 보기의 프레임과 같은 방식이다.
    private func fit(then done: (() -> Void)? = nil) {
        article.pageZoom = userZoom
        article.evaluateJavaScript("[document.documentElement.scrollWidth, window.innerWidth]") { [weak self] result, _ in
            guard let self else { return }
            if let values = result as? [NSNumber], values.count == 2 {
                let content = CGFloat(truncating: values[0]), viewport = CGFloat(truncating: values[1])
                if content > viewport + 2, content > 0 { self.article.pageZoom = max(0.3, self.userZoom * viewport / content) }
            }
            done?()
        }
    }

    private func reveal() {
        revealTimer?.invalidate()
        revealTimer = nil
        articleReady = true
        updateArticle()
    }

    private func updateArticle() {
        article.isHidden = !(wantsArticle && articleReady)
        let loading = wantsArticle && !articleReady
        spinner.sizeToFit()
        spinner.frame.origin = NSPoint(x: article.frame.midX - spinner.frame.width / 2, y: article.frame.midY - spinner.frame.height / 2)
        if loading { spinner.startAnimation(nil) } else { spinner.stopAnimation(nil) }
        debug?.snapshotSoon(app: app, article: article.isHidden ? nil : article)
    }

    // MARK: 이동

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        // FeedEx 화면 자체는 FeedEx에 머문다. 다른 사이트로 가는 링크는 기본 브라우저에서 연다.
        if webView === app, action.targetFrame?.isMainFrame == true, !sameOrigin(url, home), url.scheme != "about" {
            if let external = webAddress(url.absoluteString) { NSWorkspace.shared.open(external) }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === article, navigation === articleLoad { fit { [weak self] in self?.reveal() } }
        if webView === app { debug?.runScript(in: app) }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === article, navigation === articleLoad { reveal() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView === article, navigation === articleLoad { reveal() }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // FeedEx에서 새 창으로 여는 링크(원문 새 탭 등)는 기본 브라우저로 보낸다.
        if webView === app {
            if let url = action.request.url, let external = webAddress(url.absoluteString) { NSWorkspace.shared.open(external) }
            return nil
        }
        // 원문 사이트가 연 로그인 창은 같은 저장소를 쓰는 작은 창으로 연다.
        guard let popup = onPopup?(configuration) else { return nil }
        popup.showWindow(nil)
        popup.window?.makeKeyAndOrderFront(nil)
        return popup.browser
    }

    // MARK: FeedEx 로그인

    /// 구글은 앱 안 웹 화면의 로그인을 막으므로 시스템 로그인 창(Safari)에서 FeedEx에 로그인한다.
    /// 그 창이 넘겨준 일회용 코드는 이 창에서 시작한 로그인으로만 받는다. 다른 곳에서 온 코드로 남의 계정에
    /// 로그인되지 않게 하려는 것이다.
    private func startSignIn() {
        guard signIn == nil else { return }
        var parts = URLComponents(url: home, resolvingAgainstBaseURL: false)
        parts?.path = "/"
        parts?.queryItems = [URLQueryItem(name: "native-sign-in", value: "1")]
        guard let url = parts?.url else { return }
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "feedex-reader") { [weak self] callback, _ in
            DispatchQueue.main.async { self?.finishSignIn(callback) }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        signIn = session
        if !session.start() { signIn = nil }
    }

    private func finishSignIn(_ callback: URL?) {
        signIn = nil
        guard let callback, callback.scheme == "feedex-reader", callback.host == "signed-in",
              let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value,
              code.range(of: "^sfeed_code_[0-9a-f]{64}$", options: .regularExpression) != nil else { return }
        app.evaluateJavaScript("window.feedexNativeSignedIn && window.feedexNativeSignedIn('\(code)')")
        window?.makeKeyAndOrderFront(nil)
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { window ?? ASPresentationAnchor() }
    }
}

/// 개발할 때만 쓰는 도구. FEEDEX_DEBUG_DIR을 주고 실행하면 받은 메시지를 기록하고, 창 모습을 그림으로 남기고,
/// 그 폴더의 run.js를 FeedEx 화면에서 실행한다. 일반 실행에서는 만들어지지 않는다.
@MainActor
final class DebugTools {
    private let folder: URL
    private var snapshotTimer: Timer?

    static func fromEnvironment() -> DebugTools? {
        guard let path = ProcessInfo.processInfo.environment["FEEDEX_DEBUG_DIR"], !path.isEmpty else { return nil }
        let folder = URL(fileURLWithPath: path, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return DebugTools(folder: folder)
    }

    private init(folder: URL) { self.folder = folder }

    func log(_ body: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]),
              var line = String(data: data, encoding: .utf8) else { return }
        line += "\n"
        let file = folder.appendingPathComponent("messages.log")
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? Data(line.utf8).write(to: file)
        }
    }

    func runScript(in app: WKWebView) {
        let file = folder.appendingPathComponent("run.js")
        guard let script = try? String(contentsOf: file, encoding: .utf8) else { return }
        app.evaluateJavaScript(script)
    }

    /// 화면이 자리 잡을 때까지 잠깐 기다렸다가 FeedEx 화면과 원문 화면을 합친 그림을 남긴다.
    func snapshotSoon(app: WKWebView, article: WKWebView?) {
        snapshotTimer?.invalidate()
        snapshotTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.snapshot(app: app, article: article) }
        }
    }

    func snapshot(app: WKWebView, article: WKWebView?) {
        app.takeSnapshot(with: nil) { base, _ in
            guard let base else { return }
            let finish = { (overlay: NSImage?) in
                let size = app.bounds.size
                let image = NSImage(size: size)
                image.lockFocusFlipped(true)
                base.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: nil)
                if let overlay, let article {
                    overlay.draw(in: article.frame, from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: nil)
                }
                image.unlockFocus()
                guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                      let png = bitmap.representation(using: .png, properties: [:]) else { return }
                try? png.write(to: self.folder.appendingPathComponent("window.png"))
            }
            if let article { article.takeSnapshot(with: nil) { overlay, _ in finish(overlay) } } else { finish(nil) }
        }
    }
}
