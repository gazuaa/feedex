using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace FeedEx
{
    /// <summary>
    /// 업데이트 서명. 맥 앱의 Sparkle처럼 우리가 서명한 업데이트만 설치한다. 서명은 버전과 zip의 SHA-256을 함께 묶어
    /// 예전 버전 파일을 새 버전이라고 속여 올리지 못하게 한다. .NET Framework 4.8에 Ed25519가 없어 P-256을 쓴다.
    /// 개인 키는 배포하는 맥의 .local/keys/windows-update-p256.pem에만 있다(scripts/windows-update-signing.mjs).
    /// </summary>
    static class UpdateSignature
    {
        /// <summary>공개 키(X||Y, base64). 배포한 뒤에는 바꾸지 않는다. 바꾸면 기존 앱이 새 업데이트를 받지 못한다.</summary>
        public const string PublicKey = "9LGa0AJ6mgfTFGdp/Pq05vPBWanmJySuYUlxzlzxwTZbhRL5eQm+KCbxsQFx9Z2K0NwhkX40DDIlziXJPA+oUQ==";
        static readonly Regex VersionPattern = new Regex(@"^\d+\.\d+(\.\d+)?$", RegexOptions.CultureInvariant);
        static readonly Regex HashPattern = new Regex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);

        public static byte[] Message(string version, string sha256) => Encoding.UTF8.GetBytes("FeedEx for Windows update\n" + version + "\n" + sha256);

        public static bool Verify(string version, string sha256, string signature, string publicKey = PublicKey)
        {
            if (version == null || sha256 == null || signature == null || publicKey == null) return false;
            if (!VersionPattern.IsMatch(version) || !HashPattern.IsMatch(sha256)) return false;
            byte[] key, bytes;
            try
            {
                key = Convert.FromBase64String(publicKey);
                bytes = Convert.FromBase64String(signature);
            }
            catch (FormatException) { return false; }
            if (key.Length != 64 || bytes.Length != 64) return false;
            var x = new byte[32];
            var y = new byte[32];
            Buffer.BlockCopy(key, 0, x, 0, 32);
            Buffer.BlockCopy(key, 32, y, 0, 32);
            try
            {
                using (var ecdsa = ECDsa.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = x, Y = y } }))
                    return ecdsa.VerifyData(Message(version, sha256), bytes, HashAlgorithmName.SHA256);
            }
            catch (CryptographicException) { return false; }
        }
    }
}
