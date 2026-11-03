/* 웹 사본은 출처가 분리된 프레임이다. 허용한 영상 주소만 기기에서 직접 재생한다. */
(() => {
  const script = document.currentScript;
  let library;
  const loadLibrary = () => library ||= new Promise((resolve, reject) => {
    const node = document.createElement('script'); node.nonce = 'sfeed-scroll'; node.src = script.dataset.hls;
    node.onload = () => resolve(window.Hls); node.onerror = () => { library = null; node.remove(); reject(new Error('동영상 재생기를 불러오지 못했습니다.')); };
    document.head.append(node);
  });
  addEventListener('DOMContentLoaded', () => {
    for (const video of document.querySelectorAll('video[data-hls-src]')) {
      const box = video.parentElement, button = box.querySelector('.video-play');
      let player, loading = false;
      const fail = () => { player?.destroy(); player = null; loading = false; button.hidden = false; button.disabled = false; button.textContent = '동영상 다시 재생'; box.dataset.failed = '1'; };
      button.addEventListener('click', async () => {
        if (loading) return;
        const source = video.dataset.hlsSrc;
        if (!/^https:\/\/video\.twimg\.com\//.test(source)) return;
        if (player) { button.hidden = true; video.play().catch(fail); return; }
        loading = true; button.disabled = true; button.textContent = '동영상 준비 중…'; delete box.dataset.failed;
        try {
          if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = source; button.hidden = true; await video.play(); }
          else {
            const Hls = await loadLibrary(); if (!Hls?.isSupported()) throw new Error('지원하지 않는 영상 형식입니다.');
            player = new Hls({ enableWorker: false, maxBufferLength: 20, maxMaxBufferLength: 40 });
            player.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) fail(); });
            player.on(Hls.Events.MANIFEST_PARSED, () => { loading = false; button.hidden = true; video.play().catch(() => { button.hidden = false; button.disabled = false; button.textContent = '▶ 동영상 재생'; }); });
            player.loadSource(source); player.attachMedia(video);
          }
        } catch { fail(); }
      });
      video.addEventListener('error', fail);
    }
  }, { once: true });
})();
