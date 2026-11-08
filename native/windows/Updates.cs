using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace FeedEx
{
    /// <summary>
    /// 새 버전 확인. 사이트에 올린 FeedEx-for-Windows.json을 읽고, 새 버전이 있으면 받을 파일을 기본 브라우저로 연다.
    /// 앱이 스스로 파일을 바꾸지는 않는다. 서명 없이 내려받은 실행 파일을 몰래 바꾸지 않으려는 것이다.
    /// </summary>
    static class Updates
    {
        public static string Current
        {
            get
            {
                var version = typeof(Updates).Assembly.GetName().Version;
                return version.Major.ToString(CultureInfo.InvariantCulture) + "." + version.Minor.ToString(CultureInfo.InvariantCulture);
            }
        }

        public static async Task Check(IWin32Window owner, Uri home, Settings settings, bool quiet)
        {
            settings.LastUpdateCheck = DateTime.UtcNow;
            settings.Save();
            string latest;
            Uri download;
            try
            {
                using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) })
                {
                    var text = await http.GetStringAsync(new Uri(home, "/downloads/FeedEx-for-Windows.json?t=" + DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture)));
                    var body = Json.Parse(text) as Dictionary<string, object>;
                    latest = Json.Text(body, "version");
                    download = AppLinks.WebAddress(Json.Text(body, "download"));
                }
            }
            catch (Exception)
            {
                if (!quiet) MessageBox.Show(owner, "업데이트를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.", "FeedEx 업데이트", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (latest == null || download == null || download.Scheme != Uri.UriSchemeHttps || !Versions.Newer(latest, Current))
            {
                if (!quiet) MessageBox.Show(owner, "최신 버전을 쓰고 있어요. (FeedEx " + Current + ")", "FeedEx 업데이트", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (quiet && settings.SkippedVersion == latest) return;
            var answer = MessageBox.Show(owner,
                "새 버전(" + latest + ")을 받을 수 있어요. 지금 받을까요?\n\nFeedEx를 닫은 뒤 받은 zip을 풀어 지금 쓰는 FeedEx 폴더에 덮어쓰면 돼요.",
                "FeedEx 업데이트", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (answer == DialogResult.Yes) Shell.Open(download.AbsoluteUri);
            else
            {
                // 다음에 켤 때 같은 버전을 다시 묻지 않는다. 설정의 '업데이트 확인'으로는 언제든 받을 수 있다.
                settings.SkippedVersion = latest;
                settings.Save();
            }
        }
    }
}
