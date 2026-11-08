using System;
using System.Drawing;

namespace FeedEx
{
    /// <summary>
    /// 앱 전체 배율. 이 컴퓨터에만 저장하고, 기사별 웹 보기 배율과 글자 크기는 따로 둔다. 맥 앱과 같은 범위와 단계다.
    /// </summary>
    static class AppScale
    {
        public const double Standard = 0.9;
        public const double Minimum = 0.5;
        public const double Maximum = 1.5;

        public static double Restored(double? value)
        {
            if (!value.HasValue || double.IsNaN(value.Value) || double.IsInfinity(value.Value)) return Standard;
            return value.Value >= Minimum && value.Value <= Maximum ? value.Value : Standard;
        }

        public static double? Changed(double value, string action)
        {
            var current = Restored(value);
            switch (action)
            {
                case "smaller": return Math.Max(Minimum, Math.Round(current * 10 - 1, MidpointRounding.AwayFromZero) / 10);
                case "larger": return Math.Min(Maximum, Math.Round(current * 10 + 1, MidpointRounding.AwayFromZero) / 10);
                case "reset": return Standard;
                default: return null;
            }
        }

        /// <summary>Ctrl+휠이나 Ctrl+-로 바꾼 배율을 허용 범위 안으로 맞춘다.</summary>
        public static double Clamped(double zoom)
        {
            if (double.IsNaN(zoom) || double.IsInfinity(zoom)) return Standard;
            return Math.Round(Math.Min(Maximum, Math.Max(Minimum, zoom)), 2, MidpointRounding.AwayFromZero);
        }

        /// <summary>웹이 알려 준 CSS 좌표를 배율과 화면 DPI가 적용된 창 좌표(물리 픽셀)로 바꾼다.</summary>
        public static Rectangle Frame(RectangleF css, double scale, int dpi)
        {
            var factor = Restored(scale) * (dpi > 0 ? dpi : 96) / 96.0;
            return Rectangle.Round(new RectangleF((float)(css.X * factor), (float)(css.Y * factor), (float)(Math.Max(0, css.Width) * factor), (float)(Math.Max(0, css.Height) * factor)));
        }
    }
}
