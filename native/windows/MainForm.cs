using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace FeedEx
{
    /// <summary>
    /// FeedEx 화면을 띄우는 창. 웹 보기 자리에는 원문을 직접 연 화면을 겹쳐 놓는다. 웹 안에 넣은 사이트와 달리
    /// 사이트를 직접 연 화면이라 언론사 로그인이 유지되고, 프레임을 막는 사이트도 그대로 보인다.
    /// FeedEx 화면과 원문 화면은 같은 WebView2 저장소를 써서 앱을 다시 켜도 로그인이 남는다.
    /// </summary>
    sealed class MainForm : Form
    {
        readonly Uri home;
        readonly Settings settings;
        readonly SingleInstance instance;
        readonly WebView2 app = new WebView2();
        readonly WebView2 article = new WebView2();
        readonly Label spinner = new Label();
        readonly Timer revealTimer = new Timer { Interval = 4000 };
        readonly Timer updateTimer = new Timer { Interval = 15000 };
        readonly DebugTools debug = DebugTools.FromEnvironment();
        readonly NativeNotifications notifications;
        readonly List<string> waitingLinks = new List<string>();
        CoreWebView2Environment environment;
        string bootScript;
        bool ready;
        Uri shownArticle;
        bool articleStarting;
        ulong articleNavigation;
        bool articleReady;
        bool wantsArticle;
        double userZoom = 1;
        double appScale;
        RectangleF? articleRect;
        PendingSignIn signIn;

        public MainForm(Uri home, Settings settings, SingleInstance instance)
        {
            this.home = home;
            this.settings = settings;
            this.instance = instance;
            appScale = AppScale.Restored(settings.Scale);
            Text = "FeedEx";
            Icon = Shell.AppIcon();
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            ClientSize = new Size(1320, 880);
            MinimumSize = new Size(420, 480);
            StartPosition = FormStartPosition.CenterScreen;
            KeyPreview = true;

            app.Dock = DockStyle.Fill;
            article.Bounds = Rectangle.Empty;
            spinner.AutoSize = true;
            spinner.Text = "원문을 불러오는 중…";
            spinner.Padding = new Padding(10, 6, 10, 6);
            spinner.BackColor = SystemColors.Window;
            spinner.ForeColor = SystemColors.GrayText;
            spinner.Visible = false;
            // 앞에 넣은 것이 위에 놓인다. 원문 화면은 FeedEx 화면 위에, 불러오는 표시는 그 위에 둔다.
            Controls.Add(spinner);
            Controls.Add(article);
            Controls.Add(app);

            revealTimer.Tick += (sender, args) => Reveal();
            updateTimer.Tick += (sender, args) =>
            {
                updateTimer.Stop();
                if (DateTime.UtcNow - settings.LastUpdateCheck > TimeSpan.FromDays(1)) _ = Updates.Check(this, home, settings, true);
            };
            notifications = new NativeNotifications(Icon);
            notifications.Opened += NotificationOpened;
            notifications.ShowRequested += BringForward;
        }

        /// <summary>다른 실행이나 첫 실행 인자로 받은 주소. 창이 준비되기 전에 온 것은 모아 두었다가 처리한다.</summary>
        public void HandleLink(string text)
        {
            if (IsHandleCreated && InvokeRequired) { BeginInvoke(new Action<string>(HandleLink), text); return; }
            if (!ready) { waitingLinks.Add(text); return; }
            if (AppLinks.SignInCallback(text, out var code, out var state))
            {
                // 로그인 코드는 이 앱에서 시작한 로그인의 응답으로만 받는다. 다른 곳에서 연 주소로 남의 계정에 로그인되지 않게 한다.
                var pending = signIn;
                if (pending != null && pending.Accepts(state, DateTime.UtcNow))
                {
                    signIn = null;
                    _ = app.CoreWebView2.ExecuteScriptAsync("window.feedexNativeSignedIn && window.feedexNativeSignedIn('" + code + "')");
                }
                BringForward();
                return;
            }
            if (AppLinks.IsLaunch(text)) BringForward();
        }

        protected override async void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            RestoreWindow();
            instance.Listen(HandleLink);
            try
            {
                var folder = Path.Combine(Settings.DataFolder, debug == null ? "WebView2" : "WebView2-dev");
                Directory.CreateDirectory(folder);
                environment = await CoreWebView2Environment.CreateAsync(null, folder);
                await app.EnsureCoreWebView2Async(environment);
                await article.EnsureCoreWebView2Async(environment);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                var answer = MessageBox.Show(this, "FeedEx를 열려면 Microsoft Edge WebView2 런타임이 필요해요. 설치 페이지를 열까요?", "FeedEx", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (answer == DialogResult.Yes) Shell.Open("https://developer.microsoft.com/microsoft-edge/webview2/");
                Close();
                return;
            }
            catch (Exception error)
            {
                MessageBox.Show(this, "FeedEx 화면을 열지 못했어요.\n\n" + error.Message, "FeedEx", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                Close();
                return;
            }
            ConfigureApp();
            ConfigureArticle();
            await InstallBootScript();
            ready = true;
            debug?.State("started", StateInfo());
            app.CoreWebView2.Navigate(home.AbsoluteUri);
            foreach (var link in waitingLinks.ToArray()) HandleLink(link);
            waitingLinks.Clear();
            updateTimer.Start();
        }

        void ConfigureApp()
        {
            var core = app.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = debug != null;
            core.Settings.AreHostObjectsAllowed = false;
            // 배율은 앱이 정한다. WebView2는 페이지를 새로 불러오면 배율을 100%로 되돌리므로 불러올 때마다 다시 맞추고,
            // Ctrl+휠 같은 브라우저 확대는 끄고 Ctrl+-·+·0만 앱 배율로 받는다.
            core.Settings.IsZoomControlEnabled = false;
            core.ContentLoading += (sender, args) => KeepAppScale();
            core.WebMessageReceived += AppMessage;
            core.NavigationStarting += AppNavigationStarting;
            // FeedEx에서 새 창으로 여는 링크(원문 새 탭 등)는 기본 브라우저로 보낸다.
            core.NewWindowRequested += (sender, args) =>
            {
                args.Handled = true;
                var url = AppLinks.WebAddress(args.Uri);
                if (url != null) Shell.Open(url.AbsoluteUri);
            };
            core.NavigationCompleted += (sender, args) =>
            {
                KeepAppScale();
                debug?.RunScript(app);
            };
            core.ProcessFailed += (sender, args) =>
            {
                if (args.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited || args.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive) core.Reload();
            };
            app.KeyDown += AppKeyDown;
        }

        void ConfigureArticle()
        {
            var core = article.CoreWebView2;
            // 원문 사이트는 앱에 메시지를 보내지 못한다.
            core.Settings.IsWebMessageEnabled = false;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.AreDevToolsEnabled = debug != null;
            core.NavigationStarting += (sender, args) =>
            {
                if (!articleStarting) return;
                articleStarting = false;
                articleNavigation = args.NavigationId;
            };
            core.NavigationCompleted += (sender, args) =>
            {
                // 원문 화면 안에서 다른 사이트로 옮겨도 배율이 100%로 돌아가므로 다시 맞춘다.
                if (args.NavigationId != articleNavigation || articleReady) { if (articleReady && args.IsSuccess) Fit(); return; }
                if (args.IsSuccess) Fit(Reveal); else Reveal();
            };
            // 원문 사이트가 연 로그인 창은 같은 저장소를 쓰는 작은 창으로 연다.
            core.NewWindowRequested += (sender, args) => PopupWindow.Open(environment, args, this);
            article.Visible = false;
        }

        /// <summary>
        /// 문서마다 가장 먼저 실행해 윈도우 앱이라는 표시와 배율을 둔다. 다른 사이트의 프레임에서는 아무것도 하지 않는다.
        /// </summary>
        async Task InstallBootScript()
        {
            var core = app.CoreWebView2;
            if (core == null) return;
            var previous = bootScript;
            bootScript = null;
            if (previous != null) core.RemoveScriptToExecuteOnDocumentCreated(previous);
            var origin = Json.Serialize(AppLinks.Origin(home));
            bootScript = await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "(() => { if (window !== window.top || location.origin !== " + origin + ") return; window.feedexWindowsApp = true; window.feedexAppScale = " + ScaleText() + "; })();");
        }

        string ScaleText() => appScale.ToString("0.##", CultureInfo.InvariantCulture);

        // FeedEx 화면이 보내는 메시지

        void AppMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            // FeedEx 화면의 맨 위 문서가 보낸 것만 받는다. 프레임 안의 다른 사이트는 이 통로를 쓰지 못한다.
            if (!Uri.TryCreate(args.Source, UriKind.Absolute, out var source) || !AppLinks.SameOrigin(source, home)) return;
            Dictionary<string, object> message;
            try { message = Json.Parse(args.WebMessageAsJson) as Dictionary<string, object>; }
            catch (Exception) { return; }
            var body = Json.Object(message, "body");
            if (body == null) return;
            debug?.Log(args.WebMessageAsJson);
            switch (Json.Text(message, "channel"))
            {
                case "feedex": HandleMessage(body); break;
                case "notifications": Notify(message, body); break;
            }
        }

        void HandleMessage(Dictionary<string, object> body)
        {
            switch (Json.Text(body, "type"))
            {
                case "article": Place(body); break;
                case "signIn": StartSignIn(); break;
                case "checkForUpdates": _ = Updates.Check(this, home, settings, false); break;
                case "appScale": ChangeAppScale(Json.Text(body, "action")); break;
                case "openExternal":
                    var url = AppLinks.WebAddress(Json.Text(body, "url"));
                    if (url != null) Shell.Open(url.AbsoluteUri);
                    break;
            }
        }

        /// <summary>알림 요청은 같은 번호를 붙여 답한다. 웹은 그 번호로 기다리던 요청을 끝낸다.</summary>
        void Notify(Dictionary<string, object> message, Dictionary<string, object> body)
        {
            var id = Json.Number(message, "id");
            if (id == null) return;
            var reply = new Dictionary<string, object> { ["channel"] = "notifications", ["id"] = id.Value };
            try { reply["result"] = notifications.Handle(body); }
            catch (NotificationException error) { reply["error"] = error.Message; }
            app.CoreWebView2.PostWebMessageAsJson(Json.Serialize(reply));
        }

        void NotificationOpened()
        {
            BringForward();
            _ = app.CoreWebView2?.ExecuteScriptAsync("window.dispatchEvent(new Event('feedex-open-notification'));");
        }

        protected override void OnActivated(EventArgs e)
        {
            base.OnActivated(e);
            if (ready) _ = app.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('feedex-notification-permission'));");
        }

        // 원문 화면

        /// <summary>웹 보기 자리에 원문 화면을 놓는다. 새 글은 다 불러오거나 4초가 지난 뒤에 보여 준다.</summary>
        void Place(Dictionary<string, object> body)
        {
            var url = AppLinks.WebAddress(Json.Text(body, "url"));
            if (url == null)
            {
                wantsArticle = false;
                UpdateArticle();
                return;
            }
            if (url != shownArticle)
            {
                shownArticle = url;
                articleReady = false;
                articleStarting = true;
                article.CoreWebView2.Navigate(url.AbsoluteUri);
                revealTimer.Stop();
                revealTimer.Start();
            }
            var refit = false;
            var rect = Json.Object(body, "rect");
            var x = Json.Number(rect, "x");
            var y = Json.Number(rect, "y");
            var width = Json.Number(rect, "width");
            var height = Json.Number(rect, "height");
            if (x.HasValue && y.HasValue && width.HasValue && height.HasValue)
            {
                var css = new RectangleF((float)x.Value, (float)y.Value, (float)Math.Max(0, width.Value), (float)Math.Max(0, height.Value));
                var frame = AppScale.Frame(css, appScale, DeviceDpi);
                articleRect = css;
                refit = Math.Abs(article.Width - frame.Width) > 1;
                article.Bounds = frame;
            }
            var zoom = Json.Number(body, "zoom");
            if (zoom.HasValue && zoom.Value >= 0.25 && zoom.Value <= 3 && Math.Abs(zoom.Value - userZoom) > 0.001)
            {
                userZoom = zoom.Value;
                refit = true;
            }
            wantsArticle = Json.Flag(body, "hidden") != true;
            UpdateArticle();
            if (refit && articleReady) Fit();
        }

        /// <summary>폭이 고정된 사이트가 자리보다 넓으면 한눈에 들어오게 줄인다. 웹 보기의 프레임과 같은 방식이다.</summary>
        async void Fit(Action done = null)
        {
            try
            {
                article.ZoomFactor = userZoom;
                var values = Json.Numbers(await article.CoreWebView2.ExecuteScriptAsync("[document.documentElement.scrollWidth, window.innerWidth]"));
                if (values != null && values.Length == 2 && values[0] > values[1] + 2 && values[0] > 0)
                    article.ZoomFactor = Math.Max(0.3, userZoom * values[1] / values[0]);
            }
            catch (Exception) { /* 재지 못하면 원래 배율로 둔다. */ }
            done?.Invoke();
        }

        void Reveal()
        {
            revealTimer.Stop();
            articleReady = true;
            UpdateArticle();
        }

        void UpdateArticle()
        {
            article.Visible = wantsArticle && articleReady;
            var loading = wantsArticle && !articleReady;
            spinner.Location = new Point(article.Left + (article.Width - spinner.Width) / 2, article.Top + (article.Height - spinner.Height) / 2);
            spinner.Visible = loading;
            debug?.State("article", StateInfo());
            debug?.SnapshotSoon(this, app, article);
        }

        Dictionary<string, object> StateInfo() => new Dictionary<string, object>
        {
            ["version"] = Updates.Current,
            ["runtime"] = environment?.BrowserVersionString,
            ["dpi"] = DeviceDpi,
            ["appScale"] = appScale,
            ["articleUrl"] = shownArticle?.AbsoluteUri,
            ["articleVisible"] = article.Visible,
            ["articleBounds"] = new[] { article.Left, article.Top, article.Width, article.Height },
            ["client"] = new[] { ClientSize.Width, ClientSize.Height },
        };

        // 배율

        void ChangeAppScale(string action)
        {
            var next = AppScale.Changed(appScale, action);
            if (next.HasValue) ApplyAppScale(next.Value);
        }

        void KeepAppScale()
        {
            if (Math.Abs(app.ZoomFactor - appScale) > 0.001) app.ZoomFactor = appScale;
        }

        /// <summary>
        /// 설정의 화면 크기 버튼과 Ctrl+-·+·0이 FeedEx 화면의 배율을 바꾼다. 바뀐 값을 저장하고 웹과 원문 화면 자리에 알린다.
        /// </summary>
        void ApplyAppScale(double value)
        {
            var next = AppScale.Clamped(value);
            if (Math.Abs(next - appScale) < 0.0001) return;
            appScale = next;
            settings.Scale = next;
            settings.Save();
            _ = InstallBootScript();
            KeepAppScale();
            if (articleRect.HasValue) article.Bounds = AppScale.Frame(articleRect.Value, appScale, DeviceDpi);
            if (articleReady) Fit();
            UpdateArticle();
            _ = app.CoreWebView2.ExecuteScriptAsync("window.feedexAppScale = " + ScaleText() + "; window.dispatchEvent(new Event('feedex-app-scale')); window.dispatchEvent(new Event('resize'));");
        }

        /// <summary>Ctrl+-·+는 앱 배율을 한 단계씩, Ctrl+0은 앱 기본 크기로 바꾼다. Ctrl+[ ]는 원문 화면을 뒤로·앞으로 옮긴다.</summary>
        void AppKeyDown(object sender, KeyEventArgs args)
        {
            if (!args.Control || args.Alt) return;
            Action action = null;
            if (args.KeyCode == Keys.D0 || args.KeyCode == Keys.NumPad0) action = () => ChangeAppScale("reset");
            else if (args.KeyCode == Keys.Oemplus || args.KeyCode == Keys.Add) action = () => ChangeAppScale("larger");
            else if (args.KeyCode == Keys.OemMinus || args.KeyCode == Keys.Subtract) action = () => ChangeAppScale("smaller");
            else if (args.KeyCode == Keys.OemOpenBrackets) action = () => { if (article.Visible && article.CanGoBack) article.GoBack(); };
            else if (args.KeyCode == Keys.OemCloseBrackets) action = () => { if (article.Visible && article.CanGoForward) article.GoForward(); };
            if (action == null) return;
            args.Handled = true;
            // 이 이벤트 안에서는 WebView2를 다루지 못하므로 다음 차례에 한다.
            BeginInvoke(action);
        }

        // 이동

        void AppNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs args)
        {
            // FeedEx 화면 자체는 FeedEx에 머문다. 다른 사이트로 가는 링크는 기본 브라우저에서 연다.
            if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var url) && (AppLinks.SameOrigin(url, home) || url.Scheme == "about")) return;
            args.Cancel = true;
            var external = AppLinks.WebAddress(args.Uri);
            if (external != null) Shell.Open(external.AbsoluteUri);
            else if (url != null && url.Scheme == Uri.UriSchemeMailto) Shell.Open(url.AbsoluteUri);
        }

        // FeedEx 로그인

        /// <summary>
        /// 구글은 앱 안 웹 화면의 로그인을 막으므로 기본 브라우저에서 FeedEx에 로그인한다. 그 화면이 넘겨준 일회용 코드는
        /// 여기서 만든 상태 값과 함께 올 때만 받는다.
        /// </summary>
        void StartSignIn()
        {
            signIn = PendingSignIn.Start(DateTime.UtcNow);
            // 윈도우에서 켜 보는 확인이 같은 상태 값으로 응답을 흉내 낼 수 있게 개발 도구에만 남긴다.
            debug?.Log(Json.Serialize(new Dictionary<string, object> { ["signInStarted"] = signIn.Address(home).AbsoluteUri }));
            Shell.Open(signIn.Address(home).AbsoluteUri);
        }

        // 창

        void BringForward()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = settings.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
            Show();
            Activate();
            NativeMethods.SetForegroundWindow(Handle);
        }

        void RestoreWindow()
        {
            if (settings.Bounds is Rectangle bounds)
            {
                foreach (var screen in Screen.AllScreens)
                {
                    if (!screen.WorkingArea.IntersectsWith(bounds)) continue;
                    StartPosition = FormStartPosition.Manual;
                    Bounds = bounds;
                    break;
                }
            }
            if (settings.Maximized) WindowState = FormWindowState.Maximized;
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (articleRect.HasValue && ready) UpdateArticle();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            settings.Maximized = WindowState == FormWindowState.Maximized;
            settings.Bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            settings.Save();
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                notifications.Dispose();
                revealTimer.Dispose();
                updateTimer.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
