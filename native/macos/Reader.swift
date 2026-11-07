import AppKit
import WebKit

private func articleURL(_ input: String) -> URL? {
    guard input.utf8.count <= 8192,
          let url = URL(string: input), url.host?.isEmpty == false,
          url.user == nil, url.password == nil else { return nil }
    if url.scheme == "https" { return url }
    return nil
}

func articleLink(_ url: URL) -> URL? {
    guard url.scheme == "feedex-reader", url.host == "open",
          url.path.isEmpty, url.user == nil, url.password == nil, url.port == nil,
          url.fragment == nil,
          let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
          items.count == 1, items[0].name == "url", let input = items[0].value else { return nil }
    return articleURL(input)
}

@MainActor
final class ReaderWindow: NSWindowController, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    let browser: WKWebView
    private let address = NSTextField()
    private let status = NSTextField(labelWithString: "")
    private let back = NSButton(title: "이전", target: nil, action: nil)
    private let forward = NSButton(title: "다음", target: nil, action: nil)
    private let returnToArticle = NSButton(title: "기사로 돌아가기", target: nil, action: nil)
    private var observers: [NSKeyValueObservation] = []
    private var requestedArticle: URL?
    var onClose: (() -> Void)?
    var onPopup: ((WKWebViewConfiguration) -> ReaderWindow?)?

    init(configuration: WKWebViewConfiguration) {
        browser = WKWebView(frame: .zero, configuration: configuration)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1080, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        super.init(window: window)
        window.title = "FeedEx 읽기"
        window.minSize = NSSize(width: 480, height: 360)
        window.center()
        window.delegate = self
        window.isReleasedWhenClosed = false
        browser.navigationDelegate = self
        browser.uiDelegate = self

        address.placeholderString = "https:// 기사 주소"
        address.target = self
        address.action = #selector(openAddress)
        address.setContentHuggingPriority(.defaultLow, for: .horizontal)

        back.target = self
        back.action = #selector(goBack)
        forward.target = self
        forward.action = #selector(goForward)
        returnToArticle.target = self
        returnToArticle.action = #selector(reopenArticle)
        returnToArticle.isHidden = true
        let reload = NSButton(title: "새로고침", target: self, action: #selector(reloadPage))
        let open = NSButton(title: "열기", target: self, action: #selector(openAddress))
        let controls = NSStackView(views: [back, forward, reload, address, open, returnToArticle])
        controls.spacing = 8
        controls.edgeInsets = NSEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)

        status.textColor = .secondaryLabelColor
        status.font = .systemFont(ofSize: 12)
        status.lineBreakMode = .byTruncatingTail
        let footer = NSStackView(views: [status])
        footer.edgeInsets = NSEdgeInsets(top: 5, left: 12, bottom: 5, right: 12)

        let content = NSStackView(views: [controls, browser, footer])
        content.orientation = .vertical
        content.alignment = .width
        content.spacing = 0
        browser.setContentHuggingPriority(.defaultLow, for: .vertical)
        window.contentView = content
        window.initialFirstResponder = address
        status.stringValue = "FeedEx에서 기사를 열거나 주소를 입력하세요."

        // 같은 기사 안에서 사이트가 이동할 때도 주소와 탐색 상태를 표시한다.
        observers = [
            browser.observe(\.url, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.updateControls() }
            },
            browser.observe(\.canGoBack, options: [.initial, .new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.updateControls() }
            },
            browser.observe(\.canGoForward, options: [.initial, .new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.updateControls() }
            }
        ]
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    func display(_ url: URL) {
        showWindow(nil)
        if requestedArticle != url || browser.url == nil || browser.title == nil {
            load(url)
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func load(_ url: URL) {
        requestedArticle = url
        address.stringValue = url.absoluteString
        browser.load(URLRequest(url: url))
    }

    private func updateControls() {
        if let url = browser.url { address.stringValue = url.absoluteString }
        back.isEnabled = browser.canGoBack
        forward.isEnabled = browser.canGoForward
        returnToArticle.isHidden = requestedArticle == nil || browser.url == requestedArticle
    }

    @objc private func openAddress() {
        guard let url = articleURL(address.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            status.stringValue = "올바른 HTTPS 기사 주소를 입력하세요."
            return
        }
        window?.makeFirstResponder(browser)
        load(url)
    }

    @objc private func goBack() { browser.goBack() }
    @objc private func goForward() { browser.goForward() }
    @objc private func reopenArticle() {
        guard let url = requestedArticle else { return }
        load(url)
    }
    @objc private func reloadPage() {
        if browser.url != nil { browser.reload() }
        else if let url = requestedArticle { load(url) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false ||
            articleURL(url.absoluteString) != nil || url.absoluteString == "about:blank" {
            decisionHandler(.allow)
        } else {
            status.stringValue = "이 주소는 읽기 창에서 열 수 없습니다."
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        status.stringValue = "원문을 불러오는 중…"
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        updateControls()
        status.stringValue = webView.url?.host ?? ""
        window?.title = webView.title.map { "FeedEx 읽기 · \($0)" } ?? "FeedEx 읽기"
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError(error)
    }

    private func showError(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        status.stringValue = "원문을 열지 못했습니다. \(error.localizedDescription)"
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url,
              articleURL(url.absoluteString) != nil || url.absoluteString == "about:blank" else { return nil }
        // 사이트가 연 로그인 창은 같은 저장소를 쓰고, 브라우저가 콜백을 처리한다.
        guard let popup = onPopup?(configuration) else { return nil }
        popup.showWindow(nil)
        popup.window?.makeKeyAndOrderFront(nil)
        return popup.browser
    }

    func webViewDidClose(_ webView: WKWebView) { close() }
    func windowWillClose(_ notification: Notification) { onClose?() }
}
