using System;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace FeedEx
{
    /// <summary>
    /// 원문 사이트가 연 창(언론사 로그인 등). 원문 화면과 같은 저장소를 써서 로그인 결과가 원문 화면에도 남는다.
    /// </summary>
    sealed class PopupWindow : Form
    {
        readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };

        PopupWindow(Icon icon)
        {
            Text = "FeedEx";
            Icon = icon;
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            ClientSize = new Size(560, 720);
            MinimumSize = new Size(320, 320);
            StartPosition = FormStartPosition.CenterParent;
            Controls.Add(view);
        }

        public static async void Open(CoreWebView2Environment environment, CoreWebView2NewWindowRequestedEventArgs request, Form owner)
        {
            var deferral = request.GetDeferral();
            var popup = new PopupWindow(owner.Icon);
            try
            {
                var features = request.WindowFeatures;
                if (features.HasSize && features.Width >= 200 && features.Height >= 200)
                    popup.ClientSize = new Size((int)Math.Min(features.Width, 1600), (int)Math.Min(features.Height, 1200));
                popup.Show(owner);
                await popup.view.EnsureCoreWebView2Async(environment);
                var core = popup.view.CoreWebView2;
                core.Settings.IsWebMessageEnabled = false;
                core.Settings.AreHostObjectsAllowed = false;
                core.WindowCloseRequested += (sender, args) => popup.Close();
                core.DocumentTitleChanged += (sender, args) => popup.Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "FeedEx" : core.DocumentTitle;
                core.NewWindowRequested += (sender, args) => Open(environment, args, popup);
                request.NewWindow = core;
                request.Handled = true;
            }
            catch (Exception)
            {
                popup.Close();
            }
            finally
            {
                deferral.Complete();
            }
        }
    }
}
