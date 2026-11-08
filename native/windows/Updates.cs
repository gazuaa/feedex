using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace FeedEx
{
    /// <summary>업데이트에 필요한 것. 개발 도구로 실행할 때만 확인 창을 건너뛰고 시험용 공개 키를 쓴다.</summary>
    sealed class UpdateContext
    {
        public IWin32Window Owner { get; set; }
        public Uri Home { get; set; }
        public Settings Settings { get; set; }
        public string AppFolder { get; set; }
        public string PublicKey { get; set; } = UpdateSignature.PublicKey;
        public bool AutoAccept { get; set; }
        public Action<string> Log { get; set; } = _ => { };
        public Action<string> Restart { get; set; }
    }

    /// <summary>
    /// 자동 업데이트. 사이트의 FeedEx-for-Windows.json을 읽고, 서명이 맞는 새 버전이 있으면 묻고 받아서 설치한 뒤 다시 연다.
    /// 맥 앱의 Sparkle과 같이 하루에 한 번 확인하고, 설치는 사용자가 고른다.
    /// </summary>
    static class Updates
    {
        /// <summary>업데이트 뒤 다시 연 실행. 예전 실행이 끝날 때까지 기다렸다가 이어받는다.</summary>
        public const string RestartArgument = "--updated";
        static bool busy;

        public static string Current
        {
            get
            {
                var version = typeof(Updates).Assembly.GetName().Version;
                return version.Major.ToString(CultureInfo.InvariantCulture) + "." + version.Minor.ToString(CultureInfo.InvariantCulture);
            }
        }

        public static async Task Check(UpdateContext context, bool quiet)
        {
            if (busy) return;
            busy = true;
            try { await Run(context, quiet); }
            finally { busy = false; }
        }

        static async Task Run(UpdateContext context, bool quiet)
        {
            context.Settings.LastUpdateCheck = DateTime.UtcNow;
            context.Settings.Save();
            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) })
            {
                Dictionary<string, object> body;
                try
                {
                    var text = await http.GetStringAsync(new Uri(context.Home, "/downloads/FeedEx-for-Windows.json?t=" + DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture)));
                    body = Json.Parse(text) as Dictionary<string, object>;
                }
                catch (Exception)
                {
                    context.Log("checkFailed");
                    if (!quiet) Tell(context, "업데이트를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.", MessageBoxIcon.Warning);
                    return;
                }
                var latest = Json.Text(body, "version");
                var sha256 = Json.Text(body, "sha256");
                var download = AppLinks.WebAddress(Json.Text(body, "download"));
                // 서명이 맞지 않으면 새 버전이 있어도 설치하지 않는다.
                if (download == null || !Allowed(download, context.Home) || !UpdateSignature.Verify(latest, sha256, Json.Text(body, "signature"), context.PublicKey))
                {
                    context.Log("rejected");
                    if (!quiet) Tell(context, "업데이트 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", MessageBoxIcon.Warning);
                    return;
                }
                if (!Versions.Newer(latest, Current))
                {
                    context.Log("current");
                    if (!quiet) Tell(context, "최신 버전을 쓰고 있어요. (FeedEx " + Current + ")", MessageBoxIcon.Information);
                    return;
                }
                if (quiet && context.Settings.SkippedVersion == latest) return;
                if (!Ask(context, "새 버전(" + latest + ")을 설치할까요?\n\nFeedEx가 잠깐 닫혔다가 다시 열려요."))
                {
                    // 다음에 켤 때 같은 버전을 다시 묻지 않는다. 설정의 '업데이트 확인'으로는 언제든 설치할 수 있다.
                    context.Settings.SkippedVersion = latest;
                    context.Settings.Save();
                    context.Log("declined");
                    return;
                }
                string exe;
                var cursor = Cursor.Current;
                Cursor.Current = Cursors.WaitCursor;
                try
                {
                    var work = Path.Combine(Settings.DataFolder, "update");
                    if (Directory.Exists(work)) Directory.Delete(work, true);
                    var zip = await Updater.Download(http, download, sha256, work);
                    var staging = Updater.Extract(zip, work);
                    Updater.CheckVersion(staging, latest);
                    Updater.Install(staging, context.AppFolder);
                    exe = Path.Combine(context.AppFolder, "FeedEx.exe");
                }
                catch (Exception error)
                {
                    context.Log("installFailed: " + error.Message);
                    var reason = error is UnauthorizedAccessException ? "FeedEx 폴더에 파일을 쓸 수 없어요." : error.Message;
                    Tell(context, "업데이트를 설치하지 못했어요. 받는 페이지를 열 테니 받은 zip으로 FeedEx 폴더를 바꿔 주세요.\n\n" + reason, MessageBoxIcon.Warning);
                    if (!context.AutoAccept) Shell.Open(download.AbsoluteUri);
                    return;
                }
                finally { Cursor.Current = cursor; }
                context.Log("installed " + latest);
                context.Restart(exe);
            }
        }

        /// <summary>받을 파일은 FeedEx 사이트에 있는 것만 받는다.</summary>
        static bool Allowed(Uri download, Uri home) =>
            (download.Scheme == Uri.UriSchemeHttps && download.Host == "feedex.jyk.workers.dev") || AppLinks.SameOrigin(download, home);

        static void Tell(UpdateContext context, string text, MessageBoxIcon icon)
        {
            if (context.AutoAccept) { context.Log("message: " + text); return; }
            MessageBox.Show(context.Owner, text, "FeedEx 업데이트", MessageBoxButtons.OK, icon);
        }

        static bool Ask(UpdateContext context, string text) =>
            context.AutoAccept || MessageBox.Show(context.Owner, text, "FeedEx 업데이트", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes;
    }
}
