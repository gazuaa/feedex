using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace FeedEx
{
    /// <summary>웹 화면과 주고받는 JSON. .NET Framework에 들어 있는 직렬화기를 써서 따로 받을 파일을 늘리지 않는다.</summary>
    static class Json
    {
        static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer { MaxJsonLength = 1 << 20, RecursionLimit = 16 };

        public static object Parse(string text) => Serializer.DeserializeObject(text);
        public static string Serialize(object value) => Serializer.Serialize(value);

        public static Dictionary<string, object> Object(Dictionary<string, object> body, string key) =>
            body != null && body.TryGetValue(key, out var value) ? value as Dictionary<string, object> : null;

        public static string Text(Dictionary<string, object> body, string key) =>
            body != null && body.TryGetValue(key, out var value) ? value as string : null;

        public static double? Number(Dictionary<string, object> body, string key)
        {
            if (body == null || !body.TryGetValue(key, out var value)) return null;
            switch (value)
            {
                case int number: return number;
                case long number: return number;
                case decimal number: return (double)number;
                case double number when !double.IsNaN(number) && !double.IsInfinity(number): return number;
                default: return null;
            }
        }

        public static bool? Flag(Dictionary<string, object> body, string key) =>
            body != null && body.TryGetValue(key, out var value) && value is bool flag ? flag : (bool?)null;

        public static double[] Numbers(string json)
        {
            if (!(Parse(json) is IList values)) return null;
            var result = new double[values.Count];
            for (var index = 0; index < values.Count; index++)
            {
                if (!(values[index] is IConvertible value)) return null;
                result[index] = value.ToDouble(CultureInfo.InvariantCulture);
            }
            return result;
        }
    }

    static class Shell
    {
        /// <summary>기본 브라우저나 윈도우 설정처럼 다른 앱으로 연다.</summary>
        public static void Open(string target)
        {
            try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true })?.Dispose(); }
            catch (Exception) { /* 열 앱이 없으면 아무것도 하지 않는다. */ }
        }

        public static Icon AppIcon()
        {
            try { return Icon.ExtractAssociatedIcon(Assembly.GetEntryAssembly().Location); }
            catch (Exception) { return SystemIcons.Application; }
        }
    }

    static class NativeMethods
    {
        public const int AnyProcess = -1;

        [DllImport("user32.dll")]
        public static extern bool AllowSetForegroundWindow(int processId);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr window);
    }

    /// <summary>이 컴퓨터에만 두는 설정. 지금 사용자의 레지스트리에 저장한다.</summary>
    sealed class Settings
    {
        const string KeyPath = @"Software\FeedEx";

        public static string DataFolder => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FeedEx");

        public double Scale { get; set; } = AppScale.Standard;
        public Rectangle? Bounds { get; set; }
        public bool Maximized { get; set; }
        public string SkippedVersion { get; set; }
        public DateTime LastUpdateCheck { get; set; }

        public static Settings Load()
        {
            var settings = new Settings();
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(KeyPath))
                {
                    if (key == null) return settings;
                    if (double.TryParse(key.GetValue("AppScale") as string, NumberStyles.Float, CultureInfo.InvariantCulture, out var scale)) settings.Scale = AppScale.Restored(scale);
                    var bounds = (key.GetValue("Bounds") as string)?.Split(',');
                    if (bounds?.Length == 4 && int.TryParse(bounds[0], out var x) && int.TryParse(bounds[1], out var y) && int.TryParse(bounds[2], out var width) && int.TryParse(bounds[3], out var height) && width > 0 && height > 0)
                        settings.Bounds = new Rectangle(x, y, width, height);
                    settings.Maximized = key.GetValue("Maximized") is int maximized && maximized == 1;
                    settings.SkippedVersion = key.GetValue("SkippedVersion") as string;
                    if (long.TryParse(key.GetValue("LastUpdateCheck") as string, out var ticks) && ticks > 0) settings.LastUpdateCheck = new DateTime(ticks, DateTimeKind.Utc);
                }
            }
            catch (Exception) { /* 읽지 못하면 기본값으로 연다. */ }
            return settings;
        }

        public void Save()
        {
            try
            {
                using (var key = Registry.CurrentUser.CreateSubKey(KeyPath))
                {
                    key.SetValue("AppScale", Scale.ToString("0.##", CultureInfo.InvariantCulture));
                    if (Bounds is Rectangle bounds) key.SetValue("Bounds", string.Join(",", bounds.X, bounds.Y, bounds.Width, bounds.Height));
                    key.SetValue("Maximized", Maximized ? 1 : 0, RegistryValueKind.DWord);
                    if (SkippedVersion != null) key.SetValue("SkippedVersion", SkippedVersion);
                    key.SetValue("LastUpdateCheck", LastUpdateCheck.Ticks.ToString(CultureInfo.InvariantCulture));
                }
            }
            catch (Exception) { /* 저장하지 못해도 앱은 그대로 쓴다. */ }
        }
    }

    static class Registration
    {
        /// <summary>
        /// feedex-reader:// 주소를 이 앱으로 연다. 웹사이트의 '윈도우 앱으로 열기'와 로그인 화면이 이 주소로 앱을 부른다.
        /// 관리자 권한 없이 지금 사용자에게만 등록하고, 앱 폴더를 옮기면 다음 실행 때 새 위치로 고친다.
        /// </summary>
        public static void RegisterLinks(string exe)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + AppLinks.Scheme))
            {
                key.SetValue("", "URL:FeedEx");
                key.SetValue("URL Protocol", "");
                using (var icon = key.CreateSubKey("DefaultIcon")) icon.SetValue("", "\"" + exe + "\",0");
                using (var command = key.CreateSubKey(@"shell\open\command")) command.SetValue("", "\"" + exe + "\" \"%1\"");
            }
        }

        /// <summary>시작 메뉴에서 FeedEx를 찾고 작업 표시줄에 고정할 수 있게 바로 가기를 둔다.</summary>
        public static void AddStartMenuShortcut(string exe)
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FeedEx.lnk");
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            var shell = Activator.CreateInstance(shellType);
            try
            {
                var link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
                try
                {
                    var linkType = link.GetType();
                    if (File.Exists(path) && string.Equals(linkType.InvokeMember("TargetPath", BindingFlags.GetProperty, null, link, null) as string, exe, StringComparison.OrdinalIgnoreCase)) return;
                    linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { exe });
                    linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { Path.GetDirectoryName(exe) });
                    linkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { exe + ",0" });
                    linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "FeedEx" });
                    linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
                }
                finally { Marshal.FinalReleaseComObject(link); }
            }
            finally { Marshal.FinalReleaseComObject(shell); }
        }
    }

    /// <summary>
    /// FeedEx는 한 번만 켠다. 이미 켜져 있으면 받은 주소(로그인 응답, 창 열기)를 켜진 앱에 넘기고 끝낸다.
    /// 주소는 지금 사용자만 쓸 수 있는 파이프로 넘긴다.
    /// </summary>
    sealed class SingleInstance : IDisposable
    {
        readonly Mutex mutex;
        readonly string name;
        volatile bool stopped;

        public bool IsFirst { get; }

        public SingleInstance(string flavor)
        {
            var user = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
            name = "FeedEx-" + flavor + "-" + user + "-" + Process.GetCurrentProcess().SessionId;
            mutex = new Mutex(true, @"Local\" + name, out var created);
            IsFirst = created;
        }

        public void Forward(string text)
        {
            try
            {
                // 넘겨받은 앱이 창을 앞으로 가져올 수 있게 허락한다. 브라우저에서 누른 직후라 이 실행에는 그 권한이 있다.
                NativeMethods.AllowSetForegroundWindow(NativeMethods.AnyProcess);
                using (var pipe = new NamedPipeClientStream(".", name, PipeDirection.Out))
                {
                    pipe.Connect(5000);
                    var bytes = Encoding.UTF8.GetBytes(text);
                    pipe.Write(bytes, 0, bytes.Length);
                    pipe.Flush();
                    pipe.WaitForPipeDrain();
                }
            }
            catch (Exception) { /* 켜진 앱이 응답하지 않으면 그대로 끝낸다. */ }
        }

        public void Listen(Action<string> received)
        {
            var thread = new Thread(() =>
            {
                while (!stopped)
                {
                    try
                    {
                        using (var pipe = CreateServer())
                        {
                            pipe.WaitForConnection();
                            var text = ReadAll(pipe, 4096);
                            if (text != null) received(text);
                        }
                    }
                    catch (Exception) { if (!stopped) Thread.Sleep(500); }
                }
            }) { IsBackground = true, Name = "FeedEx links" };
            thread.Start();
        }

        NamedPipeServerStream CreateServer()
        {
            var security = new PipeSecurity();
            security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.ReadWrite, AccessControlType.Allow));
            return new NamedPipeServerStream(name, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.None, 4096, 4096, security);
        }

        static string ReadAll(Stream stream, int limit)
        {
            var buffer = new MemoryStream();
            var chunk = new byte[1024];
            int read;
            while ((read = stream.Read(chunk, 0, chunk.Length)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > limit) return null;
            }
            return Encoding.UTF8.GetString(buffer.ToArray());
        }

        public void Dispose()
        {
            stopped = true;
            if (IsFirst) { try { mutex.ReleaseMutex(); } catch (Exception) { } }
            mutex.Dispose();
        }
    }
}
