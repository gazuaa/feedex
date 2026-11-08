#!/usr/bin/env node
// 윈도우 앱 업데이트 서명(P-256). 개인 키는 이 맥의 .local/keys에만 두고 출력·커밋·기록하지 않는다.
//   --create <키 파일>                 새 키를 만들고 공개 키만 출력한다. 처음 한 번만 쓴다.
//   --public <키 파일>                 공개 키(X||Y, base64)를 출력한다.
//   --sign <키 파일> <버전> <sha256>   업데이트 서명(base64)을 출력한다.
// 앱(native/windows/UpdateSignature.cs)은 같은 메시지를 같은 공개 키로 확인한다.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const updateMessage = (version, sha256) => Buffer.from(`FeedEx for Windows update\n${version}\n${sha256}`, 'utf8');

export function publicKeyText(key) {
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  return Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64');
}

export function verifyUpdate(publicKey, version, sha256, signature) {
  const bytes = Buffer.from(publicKey, 'base64');
  if (bytes.length !== 64) return false;
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: bytes.subarray(0, 32).toString('base64url'), y: bytes.subarray(32).toString('base64url') } });
  return verify('sha256', updateMessage(version, sha256), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64'));
}

function readKey(file) {
  if (!existsSync(file)) throw new Error(`업데이트 서명 키가 없습니다: ${file}`);
  return createPrivateKey(readFileSync(file));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, file, version, sha256] = process.argv.slice(2);
  try {
    if (command === '--create') {
      if (!file) throw new Error('키 파일 경로를 주세요.');
      if (existsSync(file)) throw new Error('키 파일이 이미 있습니다. 배포한 앱의 키를 바꾸지 않습니다.');
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      chmodSync(dirname(file), 0o700);
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
      console.log(publicKeyText(privateKey));
    } else if (command === '--public') {
      console.log(publicKeyText(readKey(file)));
    } else if (command === '--sign') {
      if (!/^\d+\.\d+(\.\d+)?$/.test(version || '') || !/^[0-9a-f]{64}$/.test(sha256 || '')) throw new Error('버전과 SHA-256을 확인해 주세요.');
      const key = readKey(file);
      const signature = sign('sha256', updateMessage(version, sha256), { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
      if (!verifyUpdate(publicKeyText(key), version, sha256, signature)) throw new Error('서명을 확인하지 못했습니다.');
      console.log(signature);
    } else {
      throw new Error('사용법: --create <키> | --public <키> | --sign <키> <버전> <sha256>');
    }
  } catch (error) {
    // 키 내용은 출력하지 않는다.
    console.error(error instanceof Error ? error.message : '업데이트 서명에 실패했습니다.');
    process.exit(1);
  }
}
