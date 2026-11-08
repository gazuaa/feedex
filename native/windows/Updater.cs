using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace FeedEx
{
    sealed class UpdateException : Exception
    {
        public UpdateException(string message) : base(message) { }
    }

    /// <summary>
    /// 받은 업데이트를 확인하고 앱 폴더의 파일을 바꾼다. 실행 중인 파일은 지울 수 없지만 이름은 바꿀 수 있어서,
    /// 지금 파일을 '.feedex-old'로 옮겨 두고 새 파일을 넣는다. 하나라도 실패하면 처음 상태로 되돌린다.
    /// 창과 상관없는 코드라 맥에서도 Tests 프로젝트로 시험한다.
    /// </summary>
    static class Updater
    {
        public const string OldSuffix = ".feedex-old";
        const string Root = "FeedEx/";
        const long MaxDownload = 20 * 1024 * 1024;

        /// <summary>zip 안의 FeedEx 폴더에 있어야 하는 파일. 이것만 풀고 바꾼다.</summary>
        public static readonly string[] Files =
        {
            "FeedEx.exe",
            "FeedEx.exe.config",
            "Microsoft.Web.WebView2.Core.dll",
            "Microsoft.Web.WebView2.WinForms.dll",
            "WebView2-LICENSE.txt",
            "runtimes/win-x86/native/WebView2Loader.dll",
            "runtimes/win-x64/native/WebView2Loader.dll",
            "runtimes/win-arm64/native/WebView2Loader.dll",
        };

        static string Local(string folder, string file) => Path.Combine(folder, file.Replace('/', Path.DirectorySeparatorChar));

        public static async Task<string> Download(HttpClient http, Uri url, string sha256, string folder)
        {
            Directory.CreateDirectory(folder);
            var path = Path.Combine(folder, "update.zip");
            using (var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
            {
                if (!response.IsSuccessStatusCode) throw new UpdateException("업데이트 파일을 받지 못했어요. (HTTP " + (int)response.StatusCode + ")");
                if (response.Content.Headers.ContentLength > MaxDownload) throw new UpdateException("업데이트 파일이 너무 커요.");
                using (var source = await response.Content.ReadAsStreamAsync())
                using (var target = File.Create(path))
                {
                    var buffer = new byte[81920];
                    long total = 0;
                    int read;
                    while ((read = await source.ReadAsync(buffer, 0, buffer.Length)) > 0)
                    {
                        total += read;
                        if (total > MaxDownload) throw new UpdateException("업데이트 파일이 너무 커요.");
                        await target.WriteAsync(buffer, 0, read);
                    }
                }
            }
            if (Sha256(path) != sha256) throw new UpdateException("받은 파일이 서명한 업데이트와 달라요.");
            return path;
        }

        public static string Sha256(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var hash = SHA256.Create())
            {
                var text = new StringBuilder(64);
                foreach (var value in hash.ComputeHash(stream)) text.Append(value.ToString("x2"));
                return text.ToString();
            }
        }

        /// <summary>zip에는 FeedEx 폴더와 앱 파일만 있어야 한다. 다른 경로나 파일이 있거나 빠진 파일이 있으면 풀지 않는다.</summary>
        public static string Extract(string zip, string folder)
        {
            var staging = Path.Combine(folder, "staging");
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            Directory.CreateDirectory(staging);
            var files = new HashSet<string>(Files.Select(file => Root + file), StringComparer.Ordinal);
            var folders = new HashSet<string>(files.SelectMany(Parents), StringComparer.Ordinal);
            var found = new HashSet<string>(StringComparer.Ordinal);
            using (var archive = ZipFile.OpenRead(zip))
            {
                foreach (var entry in archive.Entries)
                {
                    var name = entry.FullName.Replace('\\', '/');
                    if (name.EndsWith("/", StringComparison.Ordinal))
                    {
                        if (!folders.Contains(name)) throw new UpdateException("업데이트 파일 구성이 예상과 달라요.");
                        continue;
                    }
                    if (!files.Contains(name) || !found.Add(name)) throw new UpdateException("업데이트 파일 구성이 예상과 달라요.");
                    var target = Local(staging, name.Substring(Root.Length));
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, true);
                }
            }
            if (found.Count != files.Count) throw new UpdateException("업데이트 파일 일부가 빠졌어요.");
            return staging;
        }

        static IEnumerable<string> Parents(string file)
        {
            for (var at = file.IndexOf('/'); at >= 0; at = file.IndexOf('/', at + 1)) yield return file.Substring(0, at + 1);
        }

        /// <summary>새 실행 파일이 업데이트 정보와 같은 버전인지. 다른 파일을 잘못 올린 경우를 막는다.</summary>
        public static void CheckVersion(string staging, string version)
        {
            var actual = AssemblyName.GetAssemblyName(Local(staging, "FeedEx.exe")).Version;
            if (!Version.TryParse(version, out var expected) || actual.Major != expected.Major || actual.Minor != expected.Minor)
                throw new UpdateException("업데이트 파일의 버전이 맞지 않아요.");
        }

        public static void Install(string staging, string app)
        {
            var moved = new List<KeyValuePair<string, string>>();
            var placed = new List<string>();
            try
            {
                foreach (var file in Files)
                {
                    var source = Local(staging, file);
                    var target = Local(app, file);
                    var old = target + OldSuffix;
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    if (File.Exists(old)) File.Delete(old);
                    if (File.Exists(target))
                    {
                        File.Move(target, old);
                        moved.Add(new KeyValuePair<string, string>(target, old));
                    }
                    File.Copy(source, target);
                    placed.Add(target);
                }
            }
            catch
            {
                foreach (var path in placed) TryDelete(path);
                for (var index = moved.Count - 1; index >= 0; index--)
                {
                    try { File.Move(moved[index].Value, moved[index].Key); } catch (Exception) { /* 되돌리지 못한 파일은 다음 실행 때 다시 확인한다. */ }
                }
                throw;
            }
        }

        /// <summary>지난 업데이트가 남긴 예전 파일을 지운다. 아직 쓰이는 파일은 다음에 지운다.</summary>
        public static void CleanUp(string app)
        {
            foreach (var file in Files) TryDelete(Local(app, file) + OldSuffix);
        }

        static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch (Exception) { /* 쓰이는 중이면 다음에 지운다. */ }
        }
    }
}
