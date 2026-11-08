using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace FeedEx
{
    /// <summary>
    /// 주소를 다루는 규칙. 창과 상관없는 코드라 맥에서도 Tests 프로젝트로 시험한다.
    /// </summary>
    static class AppLinks
    {
        public const string Scheme = "feedex-reader";
        static readonly Regex CodePattern = new Regex("^sfeed_code_[0-9a-f]{64}$", RegexOptions.CultureInvariant);
        static readonly Regex StatePattern = new Regex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);

        /// <summary>FeedEx 주소. 개발할 때만 FEEDEX_HOME으로 이 컴퓨터의 시험 서버를 쓴다.</summary>
        public static Uri Home(string value)
        {
            if (!string.IsNullOrEmpty(value) && Uri.TryCreate(value, UriKind.Absolute, out var url) && string.IsNullOrEmpty(url.UserInfo)
                && (url.Scheme == Uri.UriSchemeHttps || (url.Scheme == Uri.UriSchemeHttp && (url.Host == "localhost" || url.Host == "127.0.0.1"))))
                return url;
            return new Uri("https://feedex.jyk.workers.dev/");
        }

        /// <summary>FeedEx 화면의 출처. 화면 안에 넣는 스크립트가 이 출처에서만 움직이게 한다.</summary>
        public static string Origin(Uri url) => url.GetLeftPart(UriPartial.Authority);

        /// <summary>다른 앱이나 화면에서 열어도 되는 주소. 사용자 정보가 없는 웹 주소만 받는다.</summary>
        public static Uri WebAddress(string text)
        {
            if (string.IsNullOrEmpty(text) || text.Length > 8192) return null;
            if (!Uri.TryCreate(text, UriKind.Absolute, out var url)) return null;
            if (url.Scheme != Uri.UriSchemeHttps && url.Scheme != Uri.UriSchemeHttp) return null;
            if (string.IsNullOrEmpty(url.Host) || !string.IsNullOrEmpty(url.UserInfo)) return null;
            return url;
        }

        public static bool SameOrigin(Uri url, Uri other) =>
            url != null && other != null && url.IsAbsoluteUri && other.IsAbsoluteUri && url.Scheme == other.Scheme
            && string.Equals(url.Host, other.Host, StringComparison.OrdinalIgnoreCase) && url.Port == other.Port;

        /// <summary>기본 창 열기는 주소만 받는다. 로그인 정보나 다른 페이지 주소를 받지 않는다.</summary>
        public static bool IsLaunch(string text) => Parse(text, "launch", out var query) && query.Count == 0;

        /// <summary>
        /// 기본 브라우저의 로그인 화면이 돌려준 일회용 코드. 이 앱이 로그인을 시작할 때 만든 상태 값도 함께 와야 한다.
        /// 아무 웹사이트나 이 주소를 열 수 있으므로, 상태 값이 없으면 남의 코드로 로그인될 수 있다.
        /// </summary>
        public static bool SignInCallback(string text, out string code, out string state)
        {
            code = state = null;
            if (!Parse(text, "signed-in", out var query) || query.Count != 2) return false;
            if (!query.TryGetValue("code", out var foundCode) || !query.TryGetValue("state", out var foundState)) return false;
            if (!CodePattern.IsMatch(foundCode) || !StatePattern.IsMatch(foundState)) return false;
            code = foundCode;
            state = foundState;
            return true;
        }

        static bool Parse(string text, string host, out Dictionary<string, string> query)
        {
            query = null;
            if (string.IsNullOrEmpty(text) || text.Length > 2048) return false;
            if (!Uri.TryCreate(text, UriKind.Absolute, out var url)) return false;
            // 브라우저에 따라 끝에 /를 붙여 넘기므로 경로는 비었거나 /만 받는다.
            if (url.Scheme != Scheme || url.Host != host || (url.AbsolutePath != "/" && url.AbsolutePath.Length > 0)
                || !string.IsNullOrEmpty(url.UserInfo) || !url.IsDefaultPort || url.Fragment.Length > 0) return false;
            var found = new Dictionary<string, string>(StringComparer.Ordinal);
            var raw = url.Query.TrimStart('?');
            if (raw.Length > 0)
            {
                foreach (var part in raw.Split('&'))
                {
                    var at = part.IndexOf('=');
                    if (at <= 0) return false;
                    var name = Uri.UnescapeDataString(part.Substring(0, at));
                    if (found.ContainsKey(name)) return false;
                    found[name] = Uri.UnescapeDataString(part.Substring(at + 1));
                }
            }
            query = found;
            return true;
        }
    }

    /// <summary>
    /// 이 앱에서 시작한 FeedEx 로그인. 같은 상태 값을 가진 응답만, 10분 안에 한 번 받는다.
    /// </summary>
    sealed class PendingSignIn
    {
        public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);
        readonly DateTime started;

        public string State { get; }

        public PendingSignIn(string state, DateTime started)
        {
            State = state;
            this.started = started;
        }

        public static PendingSignIn Start(DateTime now)
        {
            var bytes = new byte[32];
            using (var random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
            var text = new StringBuilder(64);
            foreach (var value in bytes) text.Append(value.ToString("x2"));
            return new PendingSignIn(text.ToString(), now);
        }

        /// <summary>기본 브라우저에서 여는 로그인 화면. 맥 앱과 같은 화면에 윈도우 앱이라는 표시와 상태 값을 붙인다.</summary>
        public Uri Address(Uri home) => new Uri(home, "/?native-sign-in=windows&state=" + State);

        public bool Accepts(string candidate, DateTime now)
        {
            if (candidate == null || now < started || now - started > Lifetime || candidate.Length != State.Length) return false;
            // 걸린 시간으로 값을 짐작하지 못하게 끝까지 비교한다.
            var difference = 0;
            for (var index = 0; index < State.Length; index++) difference |= State[index] ^ candidate[index];
            return difference == 0;
        }
    }

    static class Versions
    {
        /// <summary>올라온 버전이 지금 버전보다 새로운지. 읽지 못하는 값은 새 버전으로 보지 않는다.</summary>
        public static bool Newer(string latest, string current) =>
            Version.TryParse(latest, out var next) && Version.TryParse(current, out var now) && Normalize(next) > Normalize(now);

        static Version Normalize(Version value) => new Version(value.Major, value.Minor, Math.Max(0, value.Build), Math.Max(0, value.Revision));
    }
}
