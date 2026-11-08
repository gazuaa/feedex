using System;
using System.Drawing;

namespace FeedEx
{
    static class Program
    {
        static int failures;

        static void Check(bool condition, string name)
        {
            if (condition) return;
            failures++;
            Console.Error.WriteLine("FAIL: " + name);
        }

        static int Main()
        {
            var code = "sfeed_code_" + new string('a', 64);
            var state = new string('b', 64);

            // 주소
            Check(AppLinks.Home(null).AbsoluteUri == "https://feedex.jyk.workers.dev/", "the default home is production");
            Check(AppLinks.Home("http://localhost:5174/").Port == 5174, "a local test server can be used");
            Check(AppLinks.Home("http://example.test/").Host == "feedex.jyk.workers.dev", "plain http is only for this computer");
            Check(AppLinks.Home("https://user:pass@example.test/").Host == "feedex.jyk.workers.dev", "no credentials in the home address");
            Check(AppLinks.Origin(new Uri("https://feedex.jyk.workers.dev/")) == "https://feedex.jyk.workers.dev", "origin has no trailing slash");
            Check(AppLinks.Origin(new Uri("http://localhost:5174/x")) == "http://localhost:5174", "origin keeps the port");
            Check(AppLinks.WebAddress("https://www.hankyung.com/article/1") != null, "web addresses are accepted");
            Check(AppLinks.WebAddress("javascript:alert(1)") == null, "scripts are refused");
            Check(AppLinks.WebAddress("file:///C:/Windows/notepad.exe") == null, "files are refused");
            Check(AppLinks.WebAddress("https://user:pass@a.test/") == null, "addresses with credentials are refused");
            Check(AppLinks.WebAddress("https://a.test/" + new string('x', 9000)) == null, "very long addresses are refused");
            Check(AppLinks.SameOrigin(new Uri("https://feedex.jyk.workers.dev/a"), new Uri("https://feedex.jyk.workers.dev/")), "same origin");
            Check(!AppLinks.SameOrigin(new Uri("https://feedex.jyk.workers.dev.evil.test/"), new Uri("https://feedex.jyk.workers.dev/")), "a longer host is another origin");
            Check(!AppLinks.SameOrigin(new Uri("http://feedex.jyk.workers.dev/"), new Uri("https://feedex.jyk.workers.dev/")), "another scheme is another origin");

            // 창 열기
            Check(AppLinks.IsLaunch("feedex-reader://launch"), "launch link");
            Check(AppLinks.IsLaunch("feedex-reader://launch/"), "launch link with the slash some browsers add");
            Check(!AppLinks.IsLaunch("feedex-reader://launch?url=https://a.test/"), "launch takes no query");
            Check(!AppLinks.IsLaunch("feedex-reader://launch/other"), "launch takes no path");
            Check(!AppLinks.IsLaunch("feedex-reader://user@launch"), "launch takes no user");
            Check(!AppLinks.IsLaunch("https://launch/"), "launch needs the app scheme");

            // 로그인 응답
            Check(AppLinks.SignInCallback("feedex-reader://signed-in?code=" + code + "&state=" + state, out var gotCode, out var gotState) && gotCode == code && gotState == state, "a sign-in callback carries code and state");
            Check(AppLinks.SignInCallback("feedex-reader://signed-in/?state=" + state + "&code=" + code, out _, out _), "order and the trailing slash do not matter");
            Check(!AppLinks.SignInCallback("feedex-reader://signed-in?code=" + code, out _, out _), "a callback without state is refused");
            Check(!AppLinks.SignInCallback("feedex-reader://signed-in?code=" + code + "&state=" + state + "&x=1", out _, out _), "extra values are refused");
            Check(!AppLinks.SignInCallback("feedex-reader://signed-in?code=" + code + "&code=" + code + "&state=" + state, out _, out _), "repeated values are refused");
            Check(!AppLinks.SignInCallback("feedex-reader://signed-in?code=sfeed_code_short&state=" + state, out _, out _), "a malformed code is refused");
            Check(!AppLinks.SignInCallback("feedex-reader://signed-in?code=" + code + "&state=" + state.ToUpperInvariant(), out _, out _), "state is lowercase hex");
            Check(!AppLinks.SignInCallback("feedex-reader://launch?code=" + code + "&state=" + state, out _, out _), "only the sign-in host carries codes");

            // 이 앱에서 시작한 로그인
            var now = new DateTime(2026, 11, 9, 0, 0, 0, DateTimeKind.Utc);
            var pending = PendingSignIn.Start(now);
            Check(System.Text.RegularExpressions.Regex.IsMatch(pending.State, "^[0-9a-f]{64}$"), "state is 32 random bytes in hex");
            Check(pending.State != PendingSignIn.Start(now).State, "each sign-in gets a new state");
            Check(pending.Address(new Uri("https://feedex.jyk.workers.dev/")).AbsoluteUri == "https://feedex.jyk.workers.dev/?native-sign-in=windows&state=" + pending.State, "the browser opens the hand-off screen for the Windows app");
            Check(pending.Accepts(pending.State, now.AddMinutes(9)), "the matching state is accepted");
            Check(!pending.Accepts(state, now), "another state is refused");
            Check(!pending.Accepts(null, now), "no state is refused");
            Check(!pending.Accepts(pending.State, now.AddMinutes(11)), "an old sign-in expires");
            Check(!pending.Accepts(pending.State, now.AddMinutes(-1)), "a clock going backwards is refused");

            // 배율
            Check(AppScale.Restored(null) == 0.9 && AppScale.Restored(double.NaN) == 0.9 && AppScale.Restored(2) == 0.9 && AppScale.Restored(0.7) == 0.7, "restored scale");
            Check(AppScale.Changed(0.9, "smaller") == 0.8 && AppScale.Changed(0.9, "larger") == 1.0 && AppScale.Changed(1.2, "reset") == 0.9, "scale steps");
            Check(AppScale.Changed(0.5, "smaller") == 0.5 && AppScale.Changed(1.5, "larger") == 1.5, "scale limits");
            Check(AppScale.Changed(0.9, "other") == null, "unknown scale action");
            Check(AppScale.Clamped(0.6666666) == 0.67 && AppScale.Clamped(0.25) == 0.5 && AppScale.Clamped(3) == 1.5, "wheel zoom is kept in range");
            Check(AppScale.Frame(new RectangleF(320, 96, 700, 640), 0.9, 96) == new Rectangle(288, 86, 630, 576), "CSS rect at 100% display");
            Check(AppScale.Frame(new RectangleF(320, 96, 700, 640), 1, 144) == new Rectangle(480, 144, 1050, 960), "CSS rect at 150% display");
            Check(AppScale.Frame(new RectangleF(0, 0, -5, 10), 1, 96).Width == 0, "negative sizes become empty");

            // 업데이트
            Check(Versions.Newer("1.1", "1.0") && Versions.Newer("2.0", "1.9") && Versions.Newer("1.0.1", "1.0"), "newer versions");
            Check(!Versions.Newer("1.0", "1.0") && !Versions.Newer("0.9", "1.0") && !Versions.Newer("x", "1.0") && !Versions.Newer(null, "1.0"), "not newer");

            if (failures > 0) return 1;
            Console.WriteLine("PASS: Windows app links, sign-in state, scale and version rules.");
            return 0;
        }
    }
}
