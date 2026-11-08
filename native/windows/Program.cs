using System;
using System.IO;
using System.Runtime.CompilerServices;
using System.Windows.Forms;

namespace FeedEx
{
    // FeedEx 윈도우 앱. FeedEx 화면을 창으로 띄우고, 웹 보기의 원문은 로그인이 유지되는 화면으로 겹쳐 보여 준다.
    // 맥 앱(native/macos)과 같은 메시지를 웹과 주고받는다.
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            var link = args.Length > 0 ? args[0] : null;
            // zip을 풀지 않고 안에서 바로 열면 실행 파일만 임시 폴더로 꺼내져 함께 둔 WebView2 파일이 없다.
            var folder = AppDomain.CurrentDomain.BaseDirectory;
            if (!File.Exists(Path.Combine(folder, "Microsoft.Web.WebView2.Core.dll")) || !File.Exists(Path.Combine(folder, "Microsoft.Web.WebView2.WinForms.dll")))
            {
                MessageBox.Show("받은 zip의 압축을 먼저 풀어 주세요.\n\nzip을 마우스 오른쪽 단추로 눌러 '모두 압축 풀기'를 한 뒤, 풀린 FeedEx 폴더의 FeedEx.exe를 열면 돼요.", "FeedEx", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            var homeOverride = Environment.GetEnvironmentVariable("FEEDEX_HOME");
            // 시험용 주소로 켠 앱은 평소 앱과 따로 돈다.
            using (var instance = new SingleInstance(string.IsNullOrEmpty(homeOverride) ? "app" : "dev"))
            {
                if (!instance.IsFirst)
                {
                    instance.Forward(link ?? "feedex-reader://launch");
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Start(instance, link, homeOverride);
            }
        }

        // WebView2를 쓰는 형식은 파일을 확인한 뒤에만 불러오도록 따로 둔다.
        [MethodImpl(MethodImplOptions.NoInlining)]
        static void Start(SingleInstance instance, string link, string homeOverride)
        {
            var exe = Application.ExecutablePath;
            if (string.IsNullOrEmpty(homeOverride))
            {
                try { Registration.RegisterLinks(exe); } catch (Exception) { /* 등록하지 못해도 앱은 연다. */ }
            }
            var form = new MainForm(AppLinks.Home(homeOverride), Settings.Load(), instance);
            if (link != null) form.HandleLink(link);
            Application.Run(form);
        }
    }
}
