import Foundation
import CryptoKit
import Darwin

// 개인 키는 소유자만 읽는 파일에 보관하고 공개 키만 출력한다. --create 없이는 만들거나 덮어쓰지 않는다.
let arguments = CommandLine.arguments
let creating = arguments.count == 3 && arguments[1] == "--create"
guard arguments.count == 2 || creating else {
    fputs("사용법: swift update-signing-key.swift [--create] 키파일\n", stderr)
    exit(1)
}
let path = arguments.last!
if creating {
    let folder = URL(fileURLWithPath: path).deletingLastPathComponent()
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let key = Curve25519.Signing.PrivateKey()
    let descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
    guard descriptor >= 0 else { fputs("키 파일을 만들지 못했습니다. 기존 키는 덮어쓰지 않습니다.\n", stderr); exit(1) }
    let file = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    try file.write(contentsOf: Data(key.rawRepresentation.base64EncodedString().utf8))
    try file.close()
}
let attributes = try FileManager.default.attributesOfItem(atPath: path)
guard (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
      (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid() else {
    fputs("서명 키 파일은 현재 사용자 소유이고 권한이 600이어야 합니다.\n", stderr)
    exit(1)
}
guard let raw = Data(base64Encoded: try Data(contentsOf: URL(fileURLWithPath: path))) else { exit(1) }
let key = try Curve25519.Signing.PrivateKey(rawRepresentation: raw)
print(key.publicKey.rawRepresentation.base64EncodedString())
