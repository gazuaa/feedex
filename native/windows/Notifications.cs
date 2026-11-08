using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Win32;

namespace FeedEx
{
    sealed class NotificationException : Exception
    {
        public NotificationException(string message) : base(message) { }
    }

    /// <summary>
    /// 서버 푸시 없이 이 컴퓨터에서 감지한 새 글만 윈도우 알림으로 보낸다. 맥 앱과 같은 요청을 받는다.
    /// 알림 영역 아이콘의 풍선 알림을 쓰므로 따로 설치할 것이 없고, 윈도우 10·11에서는 알림 센터에 나타난다.
    /// </summary>
    sealed class NativeNotifications : IDisposable
    {
        readonly NotifyIcon icon;
        Target shown;
        Target pending;

        /// <summary>알림을 눌렀을 때. 앱 창을 앞으로 가져오고 그 글을 연다.</summary>
        public event Action Opened;
        /// <summary>알림 영역 아이콘을 눌렀을 때.</summary>
        public event Action ShowRequested;

        public NativeNotifications(Icon appIcon)
        {
            icon = new NotifyIcon { Icon = appIcon, Text = "FeedEx", Visible = false };
            icon.BalloonTipClicked += (sender, args) =>
            {
                pending = shown;
                Opened?.Invoke();
            };
            icon.MouseClick += (sender, args) => { if (args.Button == MouseButtons.Left) ShowRequested?.Invoke(); };
        }

        public Dictionary<string, object> Handle(Dictionary<string, object> body)
        {
            switch (Json.Text(body, "action"))
            {
                case "status":
                case "request":
                    return new Dictionary<string, object> { ["permission"] = SystemAllows() ? "granted" : "denied" };
                case "settings":
                    Shell.Open("ms-settings:notifications");
                    return new Dictionary<string, object>();
                case "takeOpen":
                    if (pending != null && Json.Text(body, "account") == pending.Account)
                    {
                        var target = pending;
                        pending = null;
                        return new Dictionary<string, object> { ["target"] = new Dictionary<string, object> { ["account"] = target.Account, ["articleId"] = target.ArticleId } };
                    }
                    return new Dictionary<string, object>();
                case "show":
                    var next = Target.From(body);
                    var title = Json.Text(body, "title");
                    var text = Json.Text(body, "body");
                    if (next == null || title == null || text == null || title.Length > 500 || text.Length > 2000) throw new NotificationException("알림 내용을 확인해 주세요.");
                    shown = next;
                    icon.Visible = true;
                    // 윈도우가 받는 길이에 맞춘다. 제목은 63자, 본문은 255자까지다.
                    icon.ShowBalloonTip(10000, Trim(title.Length > 0 ? title : "FeedEx", 63), Trim(text.Length > 0 ? text : "새 글", 255), ToolTipIcon.None);
                    return new Dictionary<string, object>();
                default:
                    throw new NotificationException("지원하지 않는 알림 요청입니다.");
            }
        }

        /// <summary>윈도우 설정에서 앱 알림을 모두 끈 경우만 거부로 본다.</summary>
        static bool SystemAllows()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\PushNotifications"))
                    return !(key?.GetValue("ToastEnabled") is int enabled) || enabled != 0;
            }
            catch (Exception) { return true; }
        }

        static string Trim(string text, int length) => text.Length <= length ? text : text.Substring(0, length - 1) + "…";

        public void Dispose()
        {
            icon.Visible = false;
            icon.Dispose();
        }

        sealed class Target
        {
            public string Account { get; private set; }
            public string ArticleId { get; private set; }

            public static Target From(Dictionary<string, object> body)
            {
                var account = Json.Text(body, "account");
                var articleId = Json.Text(body, "articleId");
                if (string.IsNullOrEmpty(account) || account.Length > 200 || string.IsNullOrEmpty(articleId) || articleId.Length > 200) return null;
                return new Target { Account = account, ArticleId = articleId };
            }
        }
    }
}
