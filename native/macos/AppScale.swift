import Foundation
import CoreGraphics

/// 앱 전체 배율은 이 맥에만 저장한다. 기사별 웹 보기 배율과 글자 크기는 따로 둔다.
enum AppScale {
    static let preferenceKey = "FeedExAppScale"
    static let standard = 0.9
    static let minimum = 0.5
    static let maximum = 1.5

    static func restored(_ value: Double?) -> Double {
        guard let value, value.isFinite, (minimum...maximum).contains(value) else { return standard }
        return value
    }

    static func changed(_ value: Double, action: String) -> Double? {
        let current = restored(value)
        switch action {
        case "smaller": return max(minimum, (current * 10 - 1).rounded() / 10)
        case "larger": return min(maximum, (current * 10 + 1).rounded() / 10)
        case "reset": return standard
        default: return nil
        }
    }

    /// 웹이 알려 준 CSS 좌표를 배율이 적용된 맥 창의 좌표로 바꾼다.
    static func frame(_ rect: CGRect, scale: Double) -> CGRect {
        let factor = CGFloat(restored(scale))
        return rect.applying(CGAffineTransform(scaleX: factor, y: factor))
    }
}
