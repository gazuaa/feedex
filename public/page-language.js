(() => {
  let saved;
  try { saved = localStorage.getItem('feedex_language'); } catch {}
  const preferred = navigator.languages?.[0] || navigator.language || 'ko';
  const lang = saved === 'ko' || saved === 'en' ? saved : /^ko(?:-|$)/i.test(preferred) ? 'ko' : 'en';
  document.documentElement.lang = lang;
  if (lang === 'en') {
    for (const node of document.querySelectorAll('[data-en]')) node.textContent = node.dataset.en;
    if (document.documentElement.dataset.titleEn) document.title = document.documentElement.dataset.titleEn;
  }
})();
