import AppKit
import UserNotifications
import CryptoKit

struct NotificationTarget: Sendable {
    let account: String
    let articleId: String
    init?(_ body: [String: Any]) {
        guard let account = body["account"] as? String, !account.isEmpty, account.count <= 200,
              let articleId = body["articleId"] as? String, !articleId.isEmpty, articleId.count <= 200 else { return nil }
        self.account = account; self.articleId = articleId
    }
    var identifier: String { "feedex-" + SHA256.hash(data: Data("\(account)\u{0}\(articleId)".utf8)).map { String(format: "%02x", $0) }.joined() }
    var data: [String: String] { ["account": account, "articleId": articleId] }
}

/// 서버 푸시 없이 이 맥에서 감지한 새 글만 macOS 알림 센터로 보낸다.
@MainActor
final class NativeNotifications: NSObject, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()
    private var pending: NotificationTarget?
    var onOpen: (() -> Void)?

    override init() { super.init(); center.delegate = self }

    nonisolated static func permission(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional: return "granted"
        case .denied: return "denied"
        default: return "default"
        }
    }

    func handle(_ body: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        switch body["action"] as? String {
        case "status":
            center.getNotificationSettings { settings in reply(["permission": Self.permission(settings.authorizationStatus)], nil) }
        case "request":
            center.getNotificationSettings { [weak self] settings in
                let denied = settings.authorizationStatus == .denied
                Task { @MainActor in
                    guard let self else { reply(nil, "앱 창이 닫혔습니다."); return }
                    if denied { self.openSettings(); reply(["permission": "denied"], nil); return }
                    self.center.requestAuthorization(options: [.alert, .sound]) { granted, error in
                        if let error { reply(nil, error.localizedDescription) }
                        else { reply(["permission": granted ? "granted" : "denied"], nil) }
                    }
                }
            }
        case "settings": openSettings(); reply([:], nil)
        case "takeOpen":
            if let target = pending, body["account"] as? String == target.account {
                pending = nil; reply(["target": target.data], nil)
            } else { reply([:], nil) }
        case "show":
            guard let target = NotificationTarget(body), let title = body["title"] as? String,
                  let text = body["body"] as? String, title.count <= 500, text.count <= 2000 else { reply(nil, "알림 내용을 확인해 주세요."); return }
            let content = UNMutableNotificationContent()
            content.title = title; content.body = text; content.userInfo = target.data
            content.sound = .default
            center.add(UNNotificationRequest(identifier: target.identifier, content: content, trigger: nil)) { error in
                if let error { reply(nil, error.localizedDescription) } else { reply([:], nil) }
            }
        default: reply(nil, "지원하지 않는 알림 요청입니다.")
        }
    }

    private func openSettings() {
        let pane: String
        if #available(macOS 13, *) { pane = "com.apple.Notifications-Settings.extension" }
        else { pane = "com.apple.preference.notifications" }
        if let url = URL(string: "x-apple.systempreferences:\(pane)?id=dev.jyk.feedex.reader") { NSWorkspace.shared.open(url) }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                           withCompletionHandler complete: @escaping (UNNotificationPresentationOptions) -> Void) {
        complete([.banner, .list, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                           withCompletionHandler complete: @escaping () -> Void) {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let target = NotificationTarget(response.notification.request.content.userInfo as? [String: Any] ?? [:]) else { complete(); return }
        Task { @MainActor [weak self] in self?.pending = target; self?.onOpen?(); complete() }
    }
}
