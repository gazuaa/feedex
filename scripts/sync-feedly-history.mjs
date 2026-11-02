// 이어받기가 되는 다운로드를 지켜보며 10분마다 스냅숏을 반영한다.
// Feedly가 할당량 초기화를 기다리느라 다운로더를 멈춘 동안에도 마찬가지다.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { acquireLock } from './feedly-import-support.mjs';

const args = process.argv.slice(2);
if (!args.includes('--user') || !args.includes('--db')) {
  throw new Error('usage: sync-feedly-history.mjs --db <local|remote> --user <userId>');
}
const directory = '.local/feedly-import';
mkdirSync(directory, { recursive: true });
const release = acquireLock(directory, 'sync');
const script = fileURLToPath(new URL('./import-feedly-history.mjs', import.meta.url));
let downloader;
let writer;
let finish;
const completed = new Promise((resolve) => { finish = resolve; });
function start(command) {
  const path = `${directory}/${command}.log`;
  appendFileSync(path, `\n== ${new Date().toISOString()} ${command}\n`);
  const fd = openSync(path, 'a');
  const child = spawn(process.execPath, [script, command, ...args], { stdio: ['ignore', fd, fd] });
  closeSync(fd);
  return child;
}
function publish() {
  return new Promise((resolve) => {
    writer = start('write');
    writer.once('error', (error) => { console.error(error); resolve(); });
    writer.once('exit', (code) => {
      if (code) console.error(`Feedly write exited ${code}; next pass will resume.`);
      writer = undefined;
      resolve();
    });
  });
}
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    downloader?.kill(signal);
    writer?.kill(signal);
    release();
    process.exit(0);
  });
}
try {
  downloader = start('download');
  downloader.once('exit', (code) => finish(code ?? 1));
  downloader.once('error', (error) => { console.error(error); finish(1); });
  let done = false;
  completed.then(() => { done = true; });
  while (!done) {
    await publish();
    let timer;
    await Promise.race([completed, new Promise((resolve) => { timer = setTimeout(resolve, 10 * 60_000); })]);
    clearTimeout(timer);
  }
  await publish();
  process.exitCode = await completed;
} finally {
  release();
}
