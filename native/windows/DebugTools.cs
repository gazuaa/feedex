using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace FeedEx
{
    /// <summary>
    /// 개발할 때만 쓰는 도구. FEEDEX_DEBUG_DIR을 주고 실행하면 받은 메시지와 상태를 기록하고, 창 모습을 그림으로 남기고,
    /// 그 폴더의 run.js를 FeedEx 화면에서 실행한다. 일반 실행에서는 만들어지지 않는다.
    /// </summary>
    sealed class DebugTools
    {
        readonly string folder;
        readonly Timer snapshotTimer = new Timer { Interval = 1500 };
        Action pendingSnapshot;

        DebugTools(string folder)
        {
            this.folder = folder;
            snapshotTimer.Tick += (sender, args) =>
            {
                snapshotTimer.Stop();
                pendingSnapshot?.Invoke();
            };
        }

        public static DebugTools FromEnvironment()
        {
            var path = Environment.GetEnvironmentVariable("FEEDEX_DEBUG_DIR");
            if (string.IsNullOrEmpty(path)) return null;
            Directory.CreateDirectory(path);
            return new DebugTools(path);
        }

        public void Log(string json) => Append("messages.log", json);

        public void State(string label, Dictionary<string, object> state)
        {
            state["label"] = label;
            Append("state.log", Json.Serialize(state));
        }

        void Append(string name, string line)
        {
            try { File.AppendAllText(Path.Combine(folder, name), line + "\n"); }
            catch (Exception) { /* 기록하지 못해도 앱은 그대로 둔다. */ }
        }

        public async void RunScript(WebView2 app)
        {
            var file = Path.Combine(folder, "run.js");
            if (!File.Exists(file)) return;
            try { await app.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(file)); }
            catch (Exception error) { Append("messages.log", Json.Serialize(new Dictionary<string, object> { ["runError"] = error.Message })); }
        }

        /// <summary>화면이 자리 잡을 때까지 잠깐 기다렸다가 FeedEx 화면과 원문 화면을 합친 그림과 실제 화면 그림을 남긴다.</summary>
        public void SnapshotSoon(Form form, WebView2 app, WebView2 article)
        {
            pendingSnapshot = () => Snapshot(form, app, article);
            snapshotTimer.Stop();
            snapshotTimer.Start();
        }

        async void Snapshot(Form form, WebView2 app, WebView2 article)
        {
            try
            {
                using (var canvas = new Bitmap(Math.Max(1, app.Width), Math.Max(1, app.Height)))
                {
                    using (var graphics = Graphics.FromImage(canvas))
                    {
                        using (var base_ = await Capture(app)) graphics.DrawImage(base_, new Rectangle(0, 0, app.Width, app.Height));
                        if (article.Visible && article.Width > 0 && article.Height > 0)
                            using (var overlay = await Capture(article)) graphics.DrawImage(overlay, article.Bounds);
                    }
                    canvas.Save(Path.Combine(folder, "window.png"), ImageFormat.Png);
                }
                // 실제로 겹쳐 보이는 모습. 원문 화면이 FeedEx 화면 위에 놓였는지 확인한다.
                var client = form.RectangleToScreen(form.ClientRectangle);
                using (var screen = new Bitmap(Math.Max(1, client.Width), Math.Max(1, client.Height)))
                {
                    using (var graphics = Graphics.FromImage(screen)) graphics.CopyFromScreen(client.Location, Point.Empty, client.Size);
                    screen.Save(Path.Combine(folder, "screen.png"), ImageFormat.Png);
                }
            }
            catch (Exception error)
            {
                Append("messages.log", Json.Serialize(new Dictionary<string, object> { ["snapshotError"] = error.Message }));
            }
        }

        static async Task<Bitmap> Capture(WebView2 view)
        {
            using (var stream = new MemoryStream())
            {
                await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                stream.Position = 0;
                using (var image = Image.FromStream(stream)) return new Bitmap(image);
            }
        }
    }
}
