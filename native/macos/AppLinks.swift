import Foundation

enum NativeLanguage {
    private static let key = "feedex.language"

    static func setPreference(_ value: String) -> Bool {
        guard ["ko", "en", "system"].contains(value), UserDefaults.standard.string(forKey: key) != value else { return false }
        UserDefaults.standard.set(value, forKey: key)
        return true
    }

    static func text(_ korean: String, _ english: String) -> String {
        let saved = UserDefaults.standard.string(forKey: key)
        let language = saved == "ko" || saved == "en" ? saved : Locale.preferredLanguages.first
        return language?.split(separator: "-").first == "ko" ? korean : english
    }
}

/// 기본 창 열기는 주소만 받는다. 로그인 정보나 다른 페이지 주소를 받지 않는다.
func isMainAppLink(_ url: URL) -> Bool {
    url.scheme == "feedex-reader" &&
    url.host == "launch" &&
    url.path.isEmpty &&
    url.user == nil &&
    url.password == nil &&
    url.port == nil &&
    url.query == nil &&
    url.fragment == nil
}
