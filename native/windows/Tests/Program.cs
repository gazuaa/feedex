using System;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

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

            // 업데이트 서명: 버전과 zip의 SHA-256을 함께 서명한 것만 받는다.
            using (var key = ECDsa.Create(ECCurve.NamedCurves.nistP256))
            {
                var point = key.ExportParameters(false).Q;
                var bytes = new byte[64];
                Buffer.BlockCopy(point.X, 0, bytes, 0, 32);
                Buffer.BlockCopy(point.Y, 0, bytes, 32, 32);
                var publicKey = Convert.ToBase64String(bytes);
                var hash = new string('d', 64);
                var signature = Convert.ToBase64String(key.SignData(UpdateSignature.Message("1.3", hash), HashAlgorithmName.SHA256));
                Check(UpdateSignature.Verify("1.3", hash, signature, publicKey), "a signed update is accepted");
                Check(!UpdateSignature.Verify("9.9", hash, signature, publicKey), "the version is part of the signature");
                Check(!UpdateSignature.Verify("1.3", new string('e', 64), signature, publicKey), "the file hash is part of the signature");
                Check(!UpdateSignature.Verify("1.3", hash, signature), "another key's signature is refused");
                Check(!UpdateSignature.Verify("1.3", hash, null, publicKey) && !UpdateSignature.Verify("1.3", hash, "not base64", publicKey) && !UpdateSignature.Verify("1.3", hash, Convert.ToBase64String(new byte[64]), publicKey), "missing or malformed signatures are refused");
                Check(!UpdateSignature.Verify("1.3 ", hash, signature, publicKey) && !UpdateSignature.Verify("1.3", hash.ToUpperInvariant(), signature, publicKey), "only plain versions and lowercase hashes");
            }
            // 사이트에 올린 업데이트 정보는 앱에 넣은 공개 키로 확인된다(맥에서 node로 서명한 것을 .NET이 확인한다).
            var manifestPath = Path.Combine("public", "downloads", "FeedEx-for-Windows.json");
            if (File.Exists(manifestPath))
            {
                var manifest = File.ReadAllText(manifestPath);
                string Field(string name) => Regex.Match(manifest, "\"" + name + "\":\"([^\"]*)\"").Groups[1].Value;
                Check(UpdateSignature.Verify(Field("version"), Field("sha256"), Field("signature")), "the published update info is signed with the app's key");
            }

            // 업데이트 설치: zip 구성을 확인하고, 예전 파일은 이름만 바꿔 두었다가 지운다. 실패하면 되돌린다.
            var root = Path.Combine(Path.GetTempPath(), "feedex-update-test-" + Guid.NewGuid().ToString("n"));
            try
            {
                var app = Path.Combine(root, "app");
                foreach (var file in Updater.Files) Write(Path.Combine(app, file), "old " + file);
                var zip = MakeZip(root, "good.zip", Updater.Files, null);
                var staging = Updater.Extract(zip, Path.Combine(root, "work"));
                Check(File.ReadAllText(Path.Combine(staging, "runtimes", "win-x64", "native", "WebView2Loader.dll")) == "new runtimes/win-x64/native/WebView2Loader.dll", "the update is unpacked");
                Check(Throws(() => Updater.Extract(MakeZip(root, "extra.zip", Updater.Files, "FeedEx/run.bat"), Path.Combine(root, "work"))), "an extra file is refused");
                Check(Throws(() => Updater.Extract(MakeZip(root, "escape.zip", Updater.Files, "FeedEx/../evil.exe"), Path.Combine(root, "work"))), "a path outside the folder is refused");
                Check(Throws(() => Updater.Extract(MakeZip(root, "missing.zip", new[] { "FeedEx.exe" }, null), Path.Combine(root, "work"))), "a partial update is refused");
                staging = Updater.Extract(zip, Path.Combine(root, "work"));
                Updater.Install(staging, app);
                Check(File.ReadAllText(Path.Combine(app, "FeedEx.exe")) == "new FeedEx.exe", "the new app is in place");
                Check(File.ReadAllText(Path.Combine(app, "FeedEx.exe" + Updater.OldSuffix)) == "old FeedEx.exe", "the running app is only renamed");
                Updater.CleanUp(app);
                Check(!File.Exists(Path.Combine(app, "FeedEx.exe" + Updater.OldSuffix)), "old files are removed later");
                // 설치 도중 실패하면 처음 상태로 되돌린다.
                foreach (var file in Updater.Files) Write(Path.Combine(app, file), "old " + file);
                staging = Updater.Extract(zip, Path.Combine(root, "work"));
                File.Delete(Path.Combine(staging, "WebView2-LICENSE.txt"));
                Check(Throws(() => Updater.Install(staging, app)), "a broken install reports an error");
                Check(File.ReadAllText(Path.Combine(app, "FeedEx.exe")) == "old FeedEx.exe" && File.ReadAllText(Path.Combine(app, "WebView2-LICENSE.txt")) == "old WebView2-LICENSE.txt", "a broken install is rolled back");
                Check(!File.Exists(Path.Combine(app, "FeedEx.exe" + Updater.OldSuffix)), "a rollback leaves no renamed files");
                // 새 실행 파일의 버전이 업데이트 정보와 같아야 한다.
                var exeFolder = Path.Combine(root, "exe");
                Directory.CreateDirectory(exeFolder);
                File.Copy(typeof(Program).Assembly.Location, Path.Combine(exeFolder, "FeedEx.exe"));
                var own = typeof(Program).Assembly.GetName().Version;
                Check(!Throws(() => Updater.CheckVersion(exeFolder, own.Major + "." + own.Minor)), "the matching version passes");
                Check(Throws(() => Updater.CheckVersion(exeFolder, (own.Major + 1) + ".0")), "another version is refused");
            }
            finally { try { Directory.Delete(root, true); } catch (IOException) { } }

            if (failures > 0) return 1;
            Console.WriteLine("PASS: Windows app links, sign-in state, scale and version rules, update signatures, update unpacking, file swap and rollback.");
            return 0;
        }

        static void Write(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, text);
        }

        static string MakeZip(string root, string name, string[] files, string extra)
        {
            var path = Path.Combine(root, name);
            using (var archive = ZipFile.Open(path, ZipArchiveMode.Create))
            {
                foreach (var file in files)
                    using (var writer = new StreamWriter(archive.CreateEntry("FeedEx/" + file).Open())) writer.Write("new " + file);
                if (extra != null)
                    using (var writer = new StreamWriter(archive.CreateEntry(extra).Open())) writer.Write("extra");
            }
            return path;
        }

        static bool Throws(Action action)
        {
            try { action(); return false; }
            catch (Exception) { return true; }
        }
    }
}
