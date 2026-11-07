import Foundation

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
